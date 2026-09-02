import cascadeLayers from "@csstools/postcss-cascade-layers";

export default {
  plugins: [
    // Tailwind 4 emits its entire utility sheet inside cascade layers. Safari
    // before 15.4 ignores those blocks, which leaves the calendar with no
    // layout. Flatten the layers while preserving their cascade order.
    cascadeLayers(),
  ],
};
