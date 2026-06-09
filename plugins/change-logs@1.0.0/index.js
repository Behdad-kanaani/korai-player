// Minimal builtin plugin stub for Change Logs
// This file is intentionally minimal; the host may load/inspect it.
module.exports = {
  hooks: {},
  activate() { console.info('change-logs activated'); },
  deactivate() { console.info('change-logs deactivated'); }
};
