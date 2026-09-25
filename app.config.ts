// Nuxt UI theme — default control sizes standardize every input
// app-wide (one size language: lg ≈ 44px touch targets).
export default defineAppConfig({
  ui: {
    button: {
      defaultVariants: {
        size: "md",
      },
    },
    input: {
      defaultVariants: {
        size: "lg",
      },
    },
    inputNumber: {
      defaultVariants: {
        size: "lg",
      },
    },
    select: {
      defaultVariants: {
        size: "lg",
      },
    },
    selectMenu: {
      defaultVariants: {
        size: "lg",
      },
    },
  },
});
