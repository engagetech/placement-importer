
delete require.cache[require.resolve("./eslint.js")]
const eslintConfig = require("./eslint.js");

let globals = {};
eslintConfig.globals.forEach(g => globals[g] = false );
eslintConfig.globals = globals;

module.exports = eslintConfig;
