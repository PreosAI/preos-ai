/**
 * index.js — Azure Functions entry point
 * Explicitly requires all function modules so the v4 runtime
 * discovers them all. Add a new require() line here whenever
 * a new function file is added to src/functions/.
 */
require('./resales');
require('./neighborhood');
