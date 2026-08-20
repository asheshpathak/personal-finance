import { Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Marks an expense that a subscription posted by itself.
 *
 * Worth showing rather than hiding: an auto-posted charge is one nobody typed,
 * so without a marker it is indistinguishable from a manual entry — and if the
 * amount looks wrong, the fix is to correct the subscription, not this row.
 */
export function AutoBadge() {
  return (
    <Badge
      tone="primary"
      size="sm"
      title="Recorded automatically by a subscription on its due date"
    >
      <Zap className="h-2.5 w-2.5" />
      Auto
    </Badge>
  );
}
