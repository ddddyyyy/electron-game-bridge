const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function failure(code, message, fieldErrors) { return Object.assign(new Error(message), { code, fieldErrors }); }
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function id(v) { return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v); }
function canonical(p) {
  const full = path.resolve(p);
  if (fs.existsSync(full)) return fs.realpathSync(full);
  const parent = path.dirname(full);
  return parent === full ? full : path.join(canonical(parent), path.basename(full));
}
function inside(parent, child) {
  const rel = path.relative(canonical(parent), canonical(child));
  return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function runtimeErrors(r) {
  const e = {};
  if (!object(r)) return { runtime: '运行时记录必须为对象' };
  if (!id(r.id)) e.id = '无效运行时身份';
  if (typeof r.executablePath !== 'string' || !path.isAbsolute(r.executablePath)) e.executablePath = '请选择绝对可执行文件路径';
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(r.version || '')) e.version = '缺少实际版本';
  if (!['x64', 'arm64'].includes(r.arch) || r.platform !== 'darwin') e.arch = '只支持可运行的 macOS Electron';
  if (typeof r.source !== 'string' || !r.source || r.source.length > 4096) e.source = '请提供有效来源说明';
  if (!/^[a-f0-9]{64}$/.test(r.fingerprint || '')) e.fingerprint = '缺少运行时指纹';
  return e;
}
function validateGame(g, lib, metadata) {
  const e = {};
  if (!object(g)) return { game: '游戏记录必须为对象' };
  if (!id(g.id)) e.id = '无效游戏身份';
  if (typeof g.name !== 'string' || !g.name.trim() || g.name.length > 120) e.name = '名称须为 1–120 个字符';
  const adapter = Object.prototype.hasOwnProperty.call(metadata, g.adapterId) ? metadata[g.adapterId] : null;
  if (!adapter) e.adapterId = '不支持的适配方式';
  const r = lib.runtimes.find(x => object(x) && x.id === g.runtimeId);
  if (!r || lib.runtimes.filter(x => object(x) && x.id === g.runtimeId).length !== 1 || Object.keys(runtimeErrors(r)).length) e.runtimeId = '未找到有效的自动匹配运行时，请修复登记';
  if (typeof g.installPath !== 'string' || !path.isAbsolute(g.installPath)) e.installPath = '安装目录须为绝对路径';
  else {
    if (lib.games.some(x => object(x) && x.id !== g.id && typeof x.installPath === 'string' && canonical(x.installPath) === canonical(g.installPath))) e.installPath = '安装目录已登记（含符号链接别名）';
    ['entry', 'workingDirectory'].forEach(key => {
      if (typeof g[key] !== 'string' || !g[key] || path.isAbsolute(g[key]) || !inside(g.installPath, path.resolve(g.installPath, g[key]))) e[key] = '路径必须位于安装目录内';
    });
  }
  if (!Array.isArray(g.args) || g.args.length > 64 || g.args.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0') || /^(?:--(?:user-data-dir|library|test-root|library-smoke-test|inspect|require|eval|profile|config-root)(?:[=-]|$)|-[er]$)/.test(a) || a === '--')) e.args = '启动参数须为字符串列表，不能覆盖保留模式/数据参数';
  if (adapter && adapter.args === false && Array.isArray(g.args) && g.args.length) e.args = '此兼容入口不支持自定义参数，请留空';
  if (g.iconPath != null && (typeof g.iconPath !== 'string' || !path.isAbsolute(g.iconPath))) e.iconPath = '图标须为本地绝对路径';
  if (!object(g.capabilities) || Object.keys(g.capabilities).some(k => !adapter || !(k in adapter.capabilities) || g.capabilities[k] !== adapter.capabilities[k])) e.capabilities = '能力不支持或固定策略不可修改';
  if (adapter && adapter.window && g.window == null) e.window = '此适配需要窗口设置';
  if (g.window != null) {
    if (!adapter || !adapter.window || !object(g.window) || Object.keys(g.window).some(k => !['width', 'height', 'title'].includes(k)) || !Number.isInteger(g.window.width) || g.window.width < 320 || g.window.width > 7680 || !Number.isInteger(g.window.height) || g.window.height < 240 || g.window.height > 4320 || typeof g.window.title !== 'string' || g.window.title.length > 120) e.window = '此适配的窗口设置无效或不受支持';
  }
  const keys = ['id', 'name', 'iconPath', 'installPath', 'adapterId', 'runtimeId', 'entry', 'workingDirectory', 'args', 'window', 'capabilities'];
  if (Object.keys(g).some(k => !keys.includes(k))) e.game = '包含未知游戏字段';
  return e;
}
function decode(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString()); } catch (_) { throw failure('CONFIG_INVALID', '配置无法解析，请恢复备份'); }
  if (!object(value) || value.schemaVersion !== 1) throw failure('CONFIG_VERSION_UNSUPPORTED', '配置版本不受支持，原文件保持不变');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.games) || !Array.isArray(value.runtimes) || Object.keys(value).some(k => !['schemaVersion', 'revision', 'games', 'runtimes'].includes(k))) throw failure('CONFIG_INVALID', '配置顶层结构无效');
  return value;
}
module.exports = { failure, canonical, inside, sha, runtimeErrors, validateGame, decode, object, id };
function createStore(directory, defaults, metadata, io) {
  io = io || fs;
  const file = path.join(directory, 'library.json');
  function raw() {
    if (!io.existsSync(file)) return null;
    if (io.statSync(file).size > 2 * 1024 * 1024) throw failure('CONFIG_INVALID', '配置超过 2 MiB 上限');
    return io.readFileSync(file);
  }
  function atomic(target, bytes) {
    io.mkdirSync(directory, { recursive: true });
    const temp = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let fd;
    try {
      fd = io.openSync(temp, 'wx', 0o600);
      io.writeFileSync(fd, bytes); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
      io.renameSync(temp, target);
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      if (io.existsSync(temp)) io.unlinkSync(temp);
    }
  }
  function token(bytes) { return bytes === null ? 'absent' : sha(bytes); }
  function read(create) {
    let bytes;
    try {
      bytes = raw();
      if (bytes === null) {
        const initial = defaults();
        if (create) {
          const encoded = JSON.stringify(initial, null, 2) + '\n';
          atomic(file + '.bak', encoded); atomic(file, encoded); bytes = raw();
        }
        return { library: initial, token: token(bytes), errors: [] };
      }
      const library = decode(bytes);
      const counts = {};
      library.games.forEach(g => { if (object(g)) counts[g.id] = (counts[g.id] || 0) + 1; });
      const errors = library.games.map((g, index) => {
        const fields = validateGame(g, library, metadata);
        if (object(g) && counts[g.id] > 1) fields.id = '游戏身份重复';
        return Object.keys(fields).length ? { index, gameId: g && g.id, fields } : null;
      }).filter(Boolean);
      return { library, token: token(bytes), errors };
    } catch (error) { return { library: null, token: bytes ? token(bytes) : 'unreadable', errors: [], error: { code: error.code || 'CONFIG_INVALID', message: error.message } }; }
  }
  function current(request) {
    const state = read();
    if (state.error) throw failure(state.error.code, state.error.message);
    if (request.token !== state.token || request.revision !== state.library.revision) throw failure('CONFIG_CONFLICT', '配置已变化，请重新载入后编辑');
    return state;
  }
  function commit(state, library) {
    const previous = raw();
    if (token(previous) !== state.token) throw failure('CONFIG_CONFLICT', '配置已变化，请重新载入');
    library.revision++;
    const next = JSON.stringify(library, null, 2) + '\n';
    if (Buffer.byteLength(next) > 2 * 1024 * 1024) throw failure('CONFIG_INVALID', '配置超过 2 MiB 上限');
    try {
      atomic(file + '.bak', previous || JSON.stringify(state.library, null, 2) + '\n');
      atomic(file, next);
    } catch (error) { throw failure('CONFIG_WRITE_FAILED', '保存失败，原配置/备份保留：' + error.message); }
    return read();
  }
  function saveGame(request) {
    const state = current(request);
    const library = JSON.parse(JSON.stringify(state.library));
    const game = JSON.parse(JSON.stringify(request.game));
    if (!object(game)) throw failure('GAME_INVALID', '缺少游戏记录');
    if (!game.id) game.id = 'game-' + crypto.randomBytes(8).toString('hex');
    const index = library.games.findIndex(g => object(g) && g.id === game.id);
    if (index >= 0 && library.games.filter(g => object(g) && g.id === game.id).length !== 1) throw failure('DUPLICATE_GAME', '身份重复，请恢复配置');
    const fields = validateGame(game, library, metadata);
    if (Object.keys(fields).length) throw failure('GAME_INVALID', '请修正游戏配置', fields);
    if (index >= 0) {
      const old = library.games[index];
      if (old.adapterId !== game.adapterId) throw failure('GAME_INVALID', '现有游戏的适配方式不可变更，请新增游戏记录');
      if (old.runtimeId !== game.runtimeId) {
        const a = library.runtimes.find(r => r.id === old.runtimeId), b = library.runtimes.find(r => r.id === game.runtimeId);
        const data = path.join(directory, 'games', old.id, 'userdata');
        if (io.existsSync(data) && io.readdirSync(data).length && (!a || !b || ['version','arch','fingerprint'].some(k => a[k] !== b[k]))) throw failure('RUNTIME_DATA_INCOMPATIBLE', '已有运行数据的游戏不能切换未验证运行时，原配置与数据已保留');
      }
      library.games[index] = game;
    } else library.games.push(game);
    return commit(state, library);
  }
  function saveRuntime(request) {
    const state = current(request), library = JSON.parse(JSON.stringify(state.library));
    const runtime = Object.assign({}, request.runtime);
    if (!runtime.id) runtime.id = 'runtime-' + crypto.randomBytes(8).toString('hex');
    const fields = runtimeErrors(runtime);
    if (Object.keys(fields).length) throw failure('RUNTIME_INVALID', '运行时记录无效', fields);
    const old = library.runtimes.find(r => r && r.id === runtime.id);
    if (old) {
      if (['executablePath','version','arch','platform','fingerprint'].some(k => old[k] !== runtime[k])) throw failure('RUNTIME_IMMUTABLE', '运行时身份不可原位修改，请作为新运行时登记');
      return state;
    }
    library.runtimes.push(runtime);
    return commit(state, library);
  }
  function restore(expectedToken) {
    const bytes = raw();
    if (token(bytes) !== expectedToken) throw failure('CONFIG_CONFLICT', '配置已变化，请重新载入');
    try {
      const backup = io.readFileSync(file + '.bak'); decode(backup);
      if (bytes) {
        const fd = io.openSync(file + '.failed-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'), 'wx', 0o600);
        try { io.writeFileSync(fd, bytes); io.fsyncSync(fd); } finally { io.closeSync(fd); }
      }
      atomic(file, backup);
      return read();
    } catch (error) { throw failure('RESTORE_FAILED', '恢复失败，原文件与有效备份保留：' + error.message); }
  }
  return { file, read, saveGame, saveRuntime, restore };
}
module.exports.createStore = createStore;
