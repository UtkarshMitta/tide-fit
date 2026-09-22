import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Flat config. Next 16 removed `next lint`, and eslint-config-next 16 ships
 * flat config arrays, so ESLint is invoked directly via `npm run lint`.
 */
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
];

export default config;
