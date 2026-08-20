/** @type {import('tailwindcss').Config} */

/*
  The type scale is Apple's Dynamic Type ladder, adapted for Inter.

  Two things are worth knowing about the tracking column. Apple's own tracking
  curve is non-obvious — tightest at 17–20pt and *loosening* again at 34 —
  because SF Pro's optical-size axis has already tightened the letterforms by
  the time you reach display sizes. Inter carries the same axis (opsz 14–32) and
  `font-optical-sizing: auto` in the base layer feeds it, so the same shape
  applies here.

  But Inter's axis clamps at 32. Above that the letterforms stop tightening on
  their own, so `display` carries a manually heavier −0.032em to compensate.
  Without it a large balance figure looks scaled rather than set.

  Sizes are in px, not rem, and deliberately: on a phone the browser reports the
  layout viewport in CSS pixels equal to iOS points, so 17px here is literally
  Apple's 17pt Body. Line-heights are unitless so they survive a browser zoom.
*/
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: [
          // Real SF on Apple hardware; Inter is the closest free approximation
          // of its skeleton — tall x-height, neo-grotesque, closed apertures —
          // and the only Google font with both an optical-size axis and
          // tabular figures.
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI Variable",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        // token          size      line-height  tracking     weight
        display:   ["2.5rem",  { lineHeight: "1",     letterSpacing: "-0.032em", fontWeight: "700" }],
        "title-1": ["1.75rem", { lineHeight: "1.14",  letterSpacing: "-0.024em", fontWeight: "700" }],
        "title-2": ["1.375rem",{ lineHeight: "1.27",  letterSpacing: "-0.02em",  fontWeight: "700" }],
        "title-3": ["1.25rem", { lineHeight: "1.25",  letterSpacing: "-0.019em", fontWeight: "600" }],
        headline:  ["1.0625rem",{ lineHeight: "1.29", letterSpacing: "-0.017em", fontWeight: "600" }],
        body:      ["1.0625rem",{ lineHeight: "1.47", letterSpacing: "-0.014em" }],
        // The same 17px as body, tightened for a list row rather than prose.
        row:       ["1.0625rem",{ lineHeight: "1.29", letterSpacing: "-0.014em" }],
        callout:   ["1rem",    { lineHeight: "1.31",  letterSpacing: "-0.014em" }],
        subhead:   ["0.9375rem",{ lineHeight: "1.33", letterSpacing: "-0.011em" }],
        footnote:  ["0.8125rem",{ lineHeight: "1.38", letterSpacing: "-0.004em" }],
        caption:   ["0.75rem", { lineHeight: "1.33",  letterSpacing: "0" }],
        // 11px is Apple's floor and the tab-bar label size. Positive tracking:
        // small type needs air, large type needs the opposite.
        micro:     ["0.6875rem",{ lineHeight: "1.18", letterSpacing: "0.006em", fontWeight: "600" }],
        // Section eyebrows and column headers. Uppercase is applied by the
        // caller — the tracking here only makes sense with it.
        overline:  ["0.6875rem",{ lineHeight: "1.3",  letterSpacing: "0.07em",  fontWeight: "700" }],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        subtle: "hsl(var(--subtle))",
        hover: "hsl(var(--hover))",
        /* The third ink tier. Non-text use only — 3.4:1 is below AA for body
           copy, which is exactly why it exists: it is for the things that must
           be present without being read. */
        faint: "hsl(var(--faint))",
        pop: {
          DEFAULT: "hsl(var(--pop))",
          tint: "hsl(var(--pop-tint))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          tint: "hsl(var(--primary-tint))",
          border: "hsl(var(--primary-border))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        /* Semantic families each carry a fill (bars, dots, icons) and a text
           grade (4.5:1+). Using the fill for text is the classic way a
           perfectly good palette fails an audit. */
        positive: {
          DEFAULT: "hsl(var(--positive))",
          text: "hsl(var(--positive-text))",
          tint: "hsl(var(--positive-tint))",
          border: "hsl(var(--positive-border))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          text: "hsl(var(--destructive-text))",
          tint: "hsl(var(--destructive-tint))",
          border: "hsl(var(--destructive-border))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          text: "hsl(var(--warning-text))",
          tint: "hsl(var(--warning-tint))",
          border: "hsl(var(--warning-border))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          text: "hsl(var(--info-text))",
          tint: "hsl(var(--info-tint))",
          border: "hsl(var(--info-border))",
        },
        success: "hsl(var(--success))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
          7: "hsl(var(--chart-7))",
          8: "hsl(var(--chart-8))",
        },
      },
      borderRadius: {
        sm: "calc(var(--radius) - 8px)",   /* 8px  — badges, small controls */
        md: "calc(var(--radius) - 4px)",   /* 12px — inputs, rows */
        lg: "var(--radius)",               /* 16px — grouped sections */
        xl: "calc(var(--radius) + 4px)",   /* 20px — cards */
        "2xl": "calc(var(--radius) + 8px)",/* 24px — hero cards */
        "3xl": "calc(var(--radius) + 12px)",
      },
      boxShadow: {
        /*
          Light-mode elevation in iOS comes almost entirely from the grey/white
          background swap; shadow is a last resort. So these are all far softer
          than a typical web scale — nothing exceeds 0.14 alpha, nothing uses
          spread, and every blur radius is at least three times its y-offset.
          A shadow and a border never appear on the same element.
        */
        hairline: "0 0 0 0.5px hsl(240 8% 9% / 0.05)",
        xs: "0 1px 2px hsl(240 8% 9% / 0.05)",
        card: "0 1px 2px hsl(240 8% 9% / 0.04), 0 4px 12px hsl(240 8% 9% / 0.05)",
        "card-hover": "0 2px 4px hsl(240 8% 9% / 0.05), 0 8px 24px hsl(240 8% 9% / 0.07)",
        press: "0 1px 2px hsl(240 8% 9% / 0.06)",
        popover: "0 10px 32px hsl(240 8% 9% / 0.14), 0 2px 8px hsl(240 8% 9% / 0.06)",
        bar: "0 0 0 0.5px hsl(240 8% 9% / 0.05), 0 8px 24px hsl(240 8% 9% / 0.08)",
        sheet: "0 -1px 0 hsl(240 8% 9% / 0.04), 0 -20px 60px hsl(240 8% 9% / 0.12)",
        /* The pressed/active state of a primary button: the surface moving
           toward the page rather than a colour change. */
        "primary-press": "0 1px 2px hsl(var(--primary) / 0.24)",
        "primary-glow": "0 4px 16px -4px hsl(var(--primary) / 0.45)",
      },
      transitionTimingFunction: {
        ios: "var(--ease-ios)",
        spring: "var(--ease-out)",
        snappy: "var(--spring-snappy)",
        smooth: "var(--spring-smooth)",
        quick: "var(--spring-quick)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
}
