// Revisión antes de publicar (npm run lint, dentro de npm run verificar): toda variable usada debe estar declarada.
// Y una variable usada antes de su declaración en el mismo componente (dep array o render: «Cannot access before initialization»).
// El build de Vite deja pasar una variable sin declarar y la app se cae al usarla (2026-06 navOrigin, 2026-09 billingIntent,
// 2026-10 selectAll en supabase.js): esta regla la detecta en el código, sin tener que pasar por esa pantalla.
import globals from "globals";
export default [{
  files: ["src/**/*.{js,jsx}"],
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
  languageOptions: { ecmaVersion: 2024, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, __BUILD__: "readonly" } },
  rules: { "no-undef": "error", "no-use-before-define": ["error", { functions: false, classes: false, variables: false }] },
}];
