'use strict';

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function normalizeReleaseVersion(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const raw = String(value).trim().replace(/^v/i, '');
    const match = SEMVER_RE.exec(raw);
    return match ? `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}${match[5] ? `+${match[5]}` : ''}` : null;
}

function comparePrerelease(left, right) {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    const a = left.split('.');
    const b = right.split('.');
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        if (a[i] === undefined) return -1;
        if (b[i] === undefined) return 1;
        if (a[i] === b[i]) continue;
        const aNumeric = /^(0|[1-9]\d*)$/.test(a[i]);
        const bNumeric = /^(0|[1-9]\d*)$/.test(b[i]);
        if (aNumeric && bNumeric) return Number(a[i]) < Number(b[i]) ? -1 : 1;
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

function compareReleaseVersions(left, right) {
    const a = normalizeReleaseVersion(left);
    const b = normalizeReleaseVersion(right);
    if (!a || !b) return null;
    const aCore = a.split(/[+-]/, 1)[0].split('.').map(Number);
    const bCore = b.split(/[+-]/, 1)[0].split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (aCore[i] !== bCore[i]) return aCore[i] < bCore[i] ? -1 : 1;
    }
    const aPre = /-(.+?)(?:\+|$)/.exec(a)?.[1] || '';
    const bPre = /-(.+?)(?:\+|$)/.exec(b)?.[1] || '';
    return comparePrerelease(aPre, bPre);
}

function isNewerRelease(latest, current) {
    return compareReleaseVersions(latest, current) === 1;
}

/**
 * Only a real installed Windows build can use electron-updater's NSIS installer.
 * `dist/win-unpacked` and portable launches have no installed NSIS target to replace.
 */
function isSupportedWindowsInstall({ platform, isPackaged, execPath, env = {} }) {
    if (platform !== 'win32' || !isPackaged) return false;
    if (env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR) return false;

    const normalizedExecPath = String(execPath || '').replace(/\\/g, '/').replace(/\/$/, '');
    const parentName = normalizedExecPath.split('/').slice(-2, -1)[0] || '';
    if (parentName.toLowerCase() === 'win-unpacked') return false;
    return true;
}

function supportsNativeUpdater({ platform, isPackaged, execPath, env = {} }) {
    if (isSupportedWindowsInstall({ platform, isPackaged, execPath, env })) return true;
    // electron-updater can replace Linux AppImages in-place; DEB packages should use the OS package path.
    return platform === 'linux' && Boolean(isPackaged) && typeof env.APPIMAGE === 'string' && env.APPIMAGE.length > 0;
}

module.exports = { normalizeReleaseVersion, compareReleaseVersions, isNewerRelease, isSupportedWindowsInstall, supportsNativeUpdater };
