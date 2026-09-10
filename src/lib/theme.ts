import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const academicNavyTheme = defineTheme({
  name: "academic-navy",
  extends: neutralTheme,
  color: {
    accent: ["#1E3A5F", "#234876"],
    neutralStyle: "cool",
    contrast: "standard",
  },
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: {
      family: "Inter",
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: "Inter",
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      weights: { 3: "bold", 4: "bold" },
    },
    code: {
      family: "JetBrains Mono",
      fallbacks: '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
  tokens: {
    // Brand exact — override HCT-generated accent to keep #1E3A5F in light
    "--color-accent": ["#1E3A5F", "#234876"],
    "--color-on-accent": ["#FFFFFF", "#FFFFFF"],
    "--color-accent-muted": ["#1E3A5F33", "#23487633"],
    "--color-success": "#15803D",
    "--color-error": "#DC2626",
    "--color-warning": "#D97706",
  },
});
