// Minimal builtin plugin stub for Change Logs
// This file is intentionally minimal; the host may load/inspect it.
module.exports = {
  hooks: {},
  activate() { console.log('change-logs activated'); },
  deactivate() { console.log('change-logs deactivated'); }
};
