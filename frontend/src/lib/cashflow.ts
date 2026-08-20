import { categoryGroup } from './expenseCategories';

/**
 * The money-flow diagram.
 *
 * A Sankey is the single most screenshotted artefact in personal finance, and
 * the reason is that it answers a question no pie chart can: not "what share of
 * spending was groceries" but "where did the money that came in actually end
 * up". Income enters on the left, splits into what was kept and what was spent,
 * and the spending splits again into categories. The width of every ribbon is
 * the money in it.
 *
 * The layout is computed here rather than pulled from a library because the
 * shape needed is a strict three-column flow with no cycles — perhaps forty
 * lines of arithmetic against a dependency that solves the general graph case
 * nobody here has.
 */

export interface FlowExpense {
  amount: number;
  category: string;
  source?: 'manual' | 'subscription';
}

export interface FlowNode {
  id: string;
  label: string;
  value: number;
  /** 0 = source, 1 = split, 2 = leaf. */
  depth: number;
  /** Accent slot for colouring, stable across renders. */
  accent: number;
  // Geometry, filled by the layout.
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowLink {
  source: string;
  target: string;
  value: number;
  accent: number;
  /** SVG path for the ribbon. */
  path: string;
  /** Ribbon thickness at both ends. */
  thickness: number;
}

export interface CashFlow {
  nodes: FlowNode[];
  links: FlowLink[];
  /** Diagram bounds, for the viewBox. */
  width: number;
  height: number;
  /** What entered — income if known, else everything spent. */
  inflow: number;
  outflow: number;
  /** inflow − outflow. Negative means more went out than came in. */
  net: number;
  /** True when income is being used as the source rather than spending itself. */
  incomeKnown: boolean;
}

interface BuildOptions {
  expenses: FlowExpense[];
  /** Expected income for the period. 0 or undefined means "not tracked". */
  income?: number;
  /** Categories past this fold into "Other" — a ribbon of nothing reads as noise. */
  maxCategories?: number;
  width?: number;
  height?: number;
}

const GROUP_LABEL: Record<string, string> = {
  spending: 'Spending',
  investments: 'Invested',
  savings: 'Saved',
};

/** Column geometry. Node bars are thin — the ribbons carry the information. */
const NODE_WIDTH = 12;
const NODE_GAP = 6;

export function buildCashFlow({
  expenses,
  income = 0,
  maxCategories = 9,
  width = 720,
  height = 420,
}: BuildOptions): CashFlow {
  const outflow = expenses.reduce((total, e) => total + e.amount, 0);
  const incomeKnown = income > 0;
  const inflow = incomeKnown ? income : outflow;

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const byGroup = new Map<string, number>();
  const byCategory = new Map<string, { group: string; amount: number }>();

  for (const e of expenses) {
    // Subscriptions get their own branch rather than being scattered through
    // spending: "what leaves automatically" is a different question from "what
    // did I choose to buy", and it is the one people want answered.
    const group = e.source === 'subscription' ? 'subscriptions' : categoryGroup(e.category);
    byGroup.set(group, (byGroup.get(group) ?? 0) + e.amount);

    const key = `${group}:${e.category}`;
    const entry = byCategory.get(key) ?? { group, amount: 0 };
    entry.amount += e.amount;
    byCategory.set(key, entry);
  }

  const nodes: FlowNode[] = [];
  const rawLinks: { source: string; target: string; value: number; accent: number }[] = [];

  const sourceId = 'source';
  nodes.push({
    id: sourceId,
    label: incomeKnown ? 'Income' : 'Spent',
    value: inflow,
    depth: 0,
    accent: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // ── Column 1: the branches ────────────────────────────────────────────────
  const branchOrder = ['spending', 'subscriptions', 'investments', 'savings'];
  let accent = 0;

  for (const group of branchOrder) {
    const amount = byGroup.get(group) ?? 0;
    if (amount <= 0) continue;
    const id = `group:${group}`;
    nodes.push({
      id,
      label: group === 'subscriptions' ? 'Subscriptions' : GROUP_LABEL[group] ?? group,
      value: amount,
      depth: 1,
      accent: accent % 6,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    rawLinks.push({ source: sourceId, target: id, value: amount, accent: accent % 6 });
    accent += 1;
  }

  // Whatever income did not go anywhere. This is the ribbon people look for.
  const leftOver = incomeKnown ? income - outflow : 0;
  if (leftOver > 0) {
    const id = 'group:left';
    nodes.push({
      id,
      label: 'Left over',
      value: leftOver,
      depth: 1,
      accent: 5,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    rawLinks.push({ source: sourceId, target: id, value: leftOver, accent: 5 });
  }

  // ── Column 2: categories inside each branch ───────────────────────────────
  for (const group of branchOrder) {
    const groupId = `group:${group}`;
    const parent = nodes.find(n => n.id === groupId);
    if (!parent) continue;

    const rows = [...byCategory.entries()]
      .filter(([, v]) => v.group === group)
      .map(([key, v]) => ({ category: key.slice(group.length + 1), amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);

    const shown = rows.slice(0, maxCategories);
    const rest = rows.slice(maxCategories);
    const restTotal = rest.reduce((total, r) => total + r.amount, 0);

    for (const row of shown) {
      const id = `cat:${group}:${row.category}`;
      nodes.push({
        id,
        label: row.category,
        value: row.amount,
        depth: 2,
        accent: parent.accent,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      rawLinks.push({ source: groupId, target: id, value: row.amount, accent: parent.accent });
    }

    if (restTotal > 0) {
      const id = `cat:${group}:other`;
      nodes.push({
        id,
        label: `Other (${rest.length})`,
        value: restTotal,
        depth: 2,
        accent: parent.accent,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      rawLinks.push({ source: groupId, target: id, value: restTotal, accent: parent.accent });
    }
  }

  layout(nodes, width, height);
  const links = rawLinks.map(link => route(link, nodes));

  return {
    nodes,
    links,
    width,
    height,
    inflow,
    outflow,
    net: inflow - outflow,
    incomeKnown,
  };
}

/**
 * Places the nodes.
 *
 * Each column is scaled independently so it fills the available height. That is
 * a deliberate departure from a strict Sankey, where one scale would be shared:
 * here the columns always total the same amount, so sharing a scale buys
 * nothing and costs a column of dead space whenever the leaf column has more
 * gaps in it than the branch column.
 */
function layout(nodes: FlowNode[], width: number, height: number): void {
  const columns = [0, 1, 2].map(depth => nodes.filter(n => n.depth === depth));
  const columnX = [0, width / 2 - NODE_WIDTH / 2, width - NODE_WIDTH];

  columns.forEach((column, depth) => {
    if (column.length === 0) return;
    const total = column.reduce((sum, n) => sum + n.value, 0);
    if (total <= 0) return;

    const gaps = (column.length - 1) * NODE_GAP;
    const usable = Math.max(height - gaps, 10);

    let y = 0;
    for (const node of column) {
      node.x = columnX[depth] ?? 0;
      node.width = NODE_WIDTH;
      // A floor of 2px: a ribbon thinner than a hairline reads as a rendering
      // artefact rather than as a small number.
      node.height = Math.max((node.value / total) * usable, 2);
      node.y = y;
      y += node.height + NODE_GAP;
    }
  });
}

/**
 * Draws one ribbon.
 *
 * Ribbons leave a node stacked in value order and arrive stacked the same way,
 * so they never cross within a pair of columns — which is what keeps a diagram
 * with thirty links readable. The cursor per node tracks how much of its edge
 * has already been used.
 */
const cursors = new WeakMap<FlowNode, { out: number; in: number }>();

function edgeCursor(node: FlowNode) {
  let cursor = cursors.get(node);
  if (!cursor) {
    cursor = { out: 0, in: 0 };
    cursors.set(node, cursor);
  }
  return cursor;
}

function route(
  link: { source: string; target: string; value: number; accent: number },
  nodes: FlowNode[]
): FlowLink {
  const source = nodes.find(n => n.id === link.source);
  const target = nodes.find(n => n.id === link.target);

  if (!source || !target) {
    return { ...link, path: '', thickness: 0 };
  }

  const sourceTotal = nodes
    .filter(n => n.depth === source.depth + 1)
    .reduce((sum, n) => sum + n.value, 0);

  const outThickness =
    sourceTotal > 0 ? (link.value / source.value) * source.height : source.height;

  const sourceCursor = edgeCursor(source);
  const targetCursor = edgeCursor(target);

  const y0 = source.y + sourceCursor.out;
  const y1 = target.y + targetCursor.in;
  const thickness = Math.max(Math.min(outThickness, target.height), 1.5);

  sourceCursor.out += outThickness;
  targetCursor.in += target.height;

  const x0 = source.x + source.width;
  const x1 = target.x;
  // Control points at the midpoint give the flat-S curve a Sankey is read by;
  // pulling them further apart makes ribbons overlap at the ends.
  const mid = (x0 + x1) / 2;

  const top0 = y0;
  const bottom0 = y0 + outThickness;
  const top1 = y1;
  const bottom1 = y1 + target.height;

  const path = [
    `M ${x0} ${top0}`,
    `C ${mid} ${top0}, ${mid} ${top1}, ${x1} ${top1}`,
    `L ${x1} ${bottom1}`,
    `C ${mid} ${bottom1}, ${mid} ${bottom0}, ${x0} ${bottom0}`,
    'Z',
  ].join(' ');

  return { ...link, path, thickness };
}

/** Clears the per-render edge cursors. Call before rebuilding a diagram. */
export function resetFlowLayout(nodes: FlowNode[]): void {
  for (const node of nodes) cursors.delete(node);
}
