import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Minus, X, Upload, ArrowUp, ArrowDown, Trash2, Loader2, FolderOpen, Download } from 'lucide-react';
import { toPng } from 'html-to-image';

// Simple localStorage-backed storage, mirrors the shape of the Claude-artifact
// window.storage API (get/set returning {key, value}) so the rest of the app
// logic didn't need to change.
const storage = {
  get: async (key) => {
    const v = localStorage.getItem(key);
    return v === null ? null : { key, value: v };
  },
  set: async (key, value) => {
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};

const QUALITIES = [
  { key: 'base', label: 'Base Skills', short: 'Base', accent: '#2dd4c9', accentDim: '#0d5c54', glow: 'rgba(45,212,201,0.35)' },
  { key: 'legendary', label: 'Legendary', short: 'Legendary', accent: '#f0b429', accentDim: '#7a5200', glow: 'rgba(240,180,41,0.35)' },
  { key: 'epic', label: 'Epic', short: 'Epic', accent: '#a970f0', accentDim: '#4c2380', glow: 'rgba(169,112,240,0.35)' },
  { key: 'rare', label: 'Rare', short: 'Rare', accent: '#4fc3f7', accentDim: '#0d4f70', glow: 'rgba(79,195,247,0.35)' },
  { key: 'fine', label: 'Fine', short: 'Fine', accent: '#45d483', accentDim: '#0f6b3d', glow: 'rgba(69,212,131,0.35)' },
];

const DEFAULT_LAYOUT = { base: 2, legendary: 5, epic: 3, rare: 8, fine: 3 };
const LIB_KEY = 'skill-library-v1';
const LAYOUT_KEY = 'layout-v1';
const BOARD_KEY = 'board-v1';

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function resizeImageFile(file, maxSize = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
        } else if (height > maxSize) {
          width = Math.round(width * (maxSize / height)); height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('bad image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function SignIcon({ value }) {
  if (value === '' || value === null || value === undefined) return <span style={{ width: 13, display: 'inline-block' }} />;
  const n = parseFloat(value);
  if (isNaN(n)) return <span style={{ width: 13, display: 'inline-block' }} />;
  if (n > 0) return <ArrowUp size={13} color="#45d483" strokeWidth={3} />;
  if (n < 0) return <ArrowDown size={13} color="#f26d6d" strokeWidth={3} />;
  return <span style={{ color: '#7c88a8', fontSize: 13, fontWeight: 700, lineHeight: '13px' }}>~</span>;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState([]);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [board, setBoard] = useState({});
  const [picker, setPicker] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libTab, setLibTab] = useState('legendary');
  const [toast, setToast] = useState('');
  const [downloading, setDownloading] = useState(false);
  const boardSaveTimer = useRef(null);
  const fileInputRef = useRef(null);
  const uploadContext = useRef(null);
  const boardRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [lib, lay, brd] = await Promise.all([
        storage.get(LIB_KEY).catch(() => null),
        storage.get(LAYOUT_KEY).catch(() => null),
        storage.get(BOARD_KEY).catch(() => null),
      ]);
      try { if (lib) setLibrary(JSON.parse(lib.value)); } catch (e) {}
      try { if (lay) setLayout({ ...DEFAULT_LAYOUT, ...JSON.parse(lay.value) }); } catch (e) {}
      try { if (brd) setBoard(JSON.parse(brd.value)); } catch (e) {}
      setLoading(false);
    })();
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const persistLibrary = useCallback(async (next) => {
    setLibrary(next);
    const res = await storage.set(LIB_KEY, JSON.stringify(next));
    if (!res) showToast('Failed to save the library');
  }, []);

  const persistLayout = useCallback(async (next) => {
    setLayout(next);
    const res = await storage.set(LAYOUT_KEY, JSON.stringify(next));
    if (!res) showToast('Failed to save section settings');
  }, []);

  const persistBoard = useCallback((next) => {
    setBoard(next);
    if (boardSaveTimer.current) clearTimeout(boardSaveTimer.current);
    boardSaveTimer.current = setTimeout(async () => {
      const res = await storage.set(BOARD_KEY, JSON.stringify(next));
      if (!res) showToast('Failed to save progress');
    }, 500);
  }, []);

  const handleFileChosen = async (file) => {
    if (!file) return;
    const ctx = uploadContext.current;
    const targetQuality = ctx?.quality || 'legendary';
    try {
      const dataUrl = await resizeImageFile(file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Skill';
      const item = { id: uid(), name, quality: targetQuality, image: dataUrl };
      const next = [...library, item];
      await persistLibrary(next);
      if (ctx?.mode === 'picker' && ctx.cellId) assignSkillToCell(ctx.cellId, item.id);
      showToast('Icon added');
    } catch (e) {
      showToast('Failed to upload image');
    }
    uploadContext.current = null;
  };

  const assignSkillToCell = (cellId, skillId) => {
    const next = { ...board, [cellId]: { ...(board[cellId] || {}), skillId } };
    persistBoard(next);
    setPicker(null);
  };

  const clearCell = (cellId) => {
    const next = { ...board };
    delete next[cellId];
    persistBoard(next);
  };

  const updateCellValue = (cellId, field, val) => {
    const next = { ...board, [cellId]: { ...(board[cellId] || {}), [field]: val } };
    persistBoard(next);
  };

  const togglePotential = (cellId, on) => {
    const current = { ...(board[cellId] || {}) };
    if (on) current.potential = current.potential ?? '';
    else delete current.potential;
    persistBoard({ ...board, [cellId]: current });
  };

  const changeCellCount = (qualityKey, delta) => {
    const current = layout[qualityKey] ?? 0;
    const nextCount = Math.max(0, Math.min(20, current + delta));
    if (nextCount === current) return;
    if (delta < 0) {
      const cellId = `${qualityKey}-${current - 1}`;
      if (board[cellId]) {
        const ok = window.confirm('This cell has a skill in it. Remove it too?');
        if (!ok) return;
        const nb = { ...board };
        delete nb[cellId];
        persistBoard(nb);
      }
    }
    persistLayout({ ...layout, [qualityKey]: nextCount });
  };

  const renameSkill = (id, name) => persistLibrary(library.map((s) => (s.id === id ? { ...s, name } : s)));
  const changeSkillQuality = (id, quality) => persistLibrary(library.map((s) => (s.id === id ? { ...s, quality } : s)));

  const deleteSkill = (id) => {
    const ok = window.confirm('Delete this icon from the library? It will be removed from every cell using it.');
    if (!ok) return;
    persistLibrary(library.filter((s) => s.id !== id));
    const nb = { ...board };
    Object.keys(nb).forEach((cid) => { if (nb[cid]?.skillId === id) delete nb[cid]; });
    persistBoard(nb);
  };

  const openPicker = (qualityKey, index) => setPicker({ cellId: `${qualityKey}-${index}`, quality: qualityKey });
  const openUploadFor = (mode, quality, cellId) => {
    uploadContext.current = { mode, quality, cellId };
    fileInputRef.current?.click();
  };

  const handleDownload = async () => {
    if (!boardRef.current || downloading) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(boardRef.current, {
        backgroundColor: '#0a0e1a',
        pixelRatio: 3,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = 'skill-build.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      showToast('Failed to export image');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', color: '#7c88a8', fontFamily: 'Inter, sans-serif' }}>
        <Loader2 className="spin" size={22} style={{ marginRight: 8 }} /> Loading…
      </div>
    );
  }

  const skillById = (id) => library.find((s) => s.id === id);

  return (
    <div className="sc-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .sc-root, .sc-root * { box-sizing: border-box; }
        .sc-root { font-family: 'Inter', system-ui, sans-serif; background: #0a0e1a; color: #e7ecf7; padding: 18px 14px 60px; min-height: 100vh; }
        .sc-heading { font-family: 'Rajdhani', sans-serif; font-weight: 700; letter-spacing: 0.02em; }
        .spin { animation: sc-spin 1s linear infinite; }
        @keyframes sc-spin { to { transform: rotate(360deg); } }
        .sc-topbar { margin-bottom: 12px; }
        .sc-title { font-size: 22px; }
        .sc-subtitle { font-size: 12px; color: #7c88a8; margin-top: 2px; }
        .sc-actions { display: flex; gap: 8px; margin-bottom: 22px; flex-wrap: wrap; }
        .sc-libbtn { display: flex; align-items: center; gap: 6px; background: #131c33; border: 1px solid #26314d; color: #e7ecf7; padding: 8px 12px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .sc-libbtn:active { transform: scale(0.97); }
        .sc-libbtn.disabled { opacity: 0.6; pointer-events: none; }
        .sc-section { border-radius: 16px; padding: 14px 12px 16px; margin-bottom: 16px; border: 1px solid var(--acc-dim); background: linear-gradient(180deg, var(--acc-bg) 0%, #0d1424 100%); }
        .sc-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .sc-section-title { font-size: 16px; color: var(--acc); display: flex; align-items: center; gap: 8px; }
        .sc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--acc); box-shadow: 0 0 8px var(--acc); }
        .sc-stepper { display: flex; align-items: center; gap: 8px; }
        .sc-stepbtn { width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--acc-dim); background: #10182c; color: var(--acc); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .sc-stepbtn:active { transform: scale(0.92); }
        .sc-count { font-size: 13px; min-width: 16px; text-align: center; font-weight: 600; color: #cfd6e8; }
        .sc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px; }
        .sc-cell-wrap { display: flex; flex-direction: column; gap: 6px; }
        .sc-cell { aspect-ratio: 1; border-radius: 10px; position: relative; cursor: pointer; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .sc-cell.empty { border: 1.5px dashed var(--acc-dim); background: #0c1220; color: var(--acc-dim); }
        .sc-cell.empty:active { background: #101a30; }
        .sc-cell.filled { border: 1.5px solid var(--acc); background: #0c1220; box-shadow: 0 0 10px var(--acc-glow) inset; }
        .sc-cell img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
        .sc-cell .sc-remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 5px; background: rgba(10,14,26,0.85); border: 1px solid #26314d; color: #cfd6e8; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .sc-name { font-size: 9.5px; color: #8b96b8; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 2px; }
        .sc-values { background: #0c1220; border: 1px solid #1c2540; border-radius: 8px; padding: 5px 5px; display: flex; flex-direction: column; gap: 5px; }
        .sc-vrow { display: flex; flex-direction: column; gap: 2px; }
        .sc-vlabel { font-size: 7px; color: #5b6784; text-transform: uppercase; letter-spacing: 0.04em; }
        .sc-vline { display: flex; align-items: center; gap: 3px; }
        .sc-vinput { width: 100%; min-width: 0; background: transparent; border: none; border-bottom: 1px solid #26314d; color: #e7ecf7; font-size: 11px; padding: 1px 2px; text-align: right; }
        .sc-vinput:focus { outline: none; border-bottom-color: var(--acc); }
        .sc-vinput::-webkit-outer-spin-button, .sc-vinput::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .sc-vinput[type=number] { -moz-appearance: textfield; }
        .sc-vpct { font-size: 9px; color: #5b6784; }
        .sc-addpot { font-size: 9px; color: #5b6784; text-decoration: underline; cursor: pointer; text-align: center; }
        .sc-overlay { position: fixed; inset: 0; background: rgba(6,9,18,0.82); display: flex; align-items: flex-end; justify-content: center; z-index: 50; }
        .sc-modal { background: #10182c; width: 100%; max-width: 520px; max-height: 82vh; border-radius: 18px 18px 0 0; padding: 16px; overflow-y: auto; border: 1px solid #26314d; border-bottom: none; }
        .sc-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .sc-modal-title { font-size: 17px; }
        .sc-close { width: 30px; height: 30px; border-radius: 9px; background: #1a2338; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #cfd6e8; flex-shrink: 0; }
        .sc-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; margin-bottom: 14px; }
        .sc-pick-item { aspect-ratio: 1; border-radius: 9px; background: #0c1220; border: 1px solid #26314d; display: flex; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; }
        .sc-pick-item img { width: 100%; height: 100%; object-fit: contain; padding: 5px; }
        .sc-pick-item:active { border-color: #5b6784; }
        .sc-empty-msg { font-size: 12.5px; color: #5b6784; text-align: center; padding: 18px 6px; line-height: 1.5; }
        .sc-uploadbtn { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; padding: 11px; border-radius: 10px; border: 1px dashed #3a4666; color: #9aa5c4; font-size: 13px; font-weight: 600; cursor: pointer; background: #0c1220; }
        .sc-tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 12px; padding-bottom: 2px; }
        .sc-tab { flex-shrink: 0; padding: 6px 11px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid #26314d; background: #131c33; color: #8b96b8; }
        .sc-lib-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-bottom: 1px solid #1a2338; }
        .sc-lib-thumb { width: 40px; height: 40px; border-radius: 8px; background: #0c1220; border: 1px solid #26314d; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .sc-lib-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
        .sc-lib-name { flex: 1; min-width: 0; background: transparent; border: none; border-bottom: 1px solid transparent; color: #e7ecf7; font-size: 13px; padding: 3px 2px; }
        .sc-lib-name:focus { outline: none; border-bottom-color: #5b6784; }
        .sc-lib-select { background: #0c1220; border: 1px solid #26314d; color: #cfd6e8; font-size: 11px; border-radius: 6px; padding: 3px 4px; flex-shrink: 0; }
        .sc-lib-del { color: #f26d6d; cursor: pointer; padding: 4px; flex-shrink: 0; }
        .sc-toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: #1a2338; border: 1px solid #2e3a5c; color: #e7ecf7; padding: 9px 16px; border-radius: 10px; font-size: 12.5px; z-index: 80; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
        .sc-footer { text-align: center; margin-top: 26px; font-size: 11px; color: #3d4a6b; }
        .sc-reset { text-decoration: underline; cursor: pointer; color: #5b6784; }
      `}</style>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; handleFileChosen(f); e.target.value = ''; }} />

      <div className="sc-topbar">
        <div className="sc-heading sc-title">Skill Constructor</div>
        <div className="sc-subtitle">Tap a cell to choose a skill</div>
      </div>
      <div className="sc-actions">
        <div className="sc-libbtn" onClick={() => setLibraryOpen(true)}>
          <FolderOpen size={15} /> Library
        </div>
        <div className={`sc-libbtn ${downloading ? 'disabled' : ''}`} onClick={handleDownload}>
          {downloading ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download
        </div>
      </div>

      <div ref={boardRef}>
        {QUALITIES.map((q) => {
          const count = layout[q.key] ?? 0;
          const showValues = q.key !== 'base';
          return (
            <div key={q.key} className="sc-section" style={{ '--acc': q.accent, '--acc-dim': q.accentDim, '--acc-glow': q.glow, '--acc-bg': q.accentDim + '22' }}>
              <div className="sc-section-head">
                <div className="sc-heading sc-section-title"><span className="sc-dot" />{q.label}</div>
                <div className="sc-stepper">
                  <div className="sc-stepbtn" onClick={() => changeCellCount(q.key, -1)}><Minus size={13} /></div>
                  <div className="sc-count">{count}</div>
                  <div className="sc-stepbtn" onClick={() => changeCellCount(q.key, 1)}><Plus size={13} /></div>
                </div>
              </div>
              {count === 0 ? (
                <div className="sc-empty-msg">No cells yet — add one with the + above</div>
              ) : (
                <div className="sc-grid">
                  {Array.from({ length: count }).map((_, i) => {
                    const cellId = `${q.key}-${i}`;
                    const cellData = board[cellId];
                    const skill = cellData ? skillById(cellData.skillId) : null;
                    const hasPotential = cellData && cellData.potential !== undefined;
                    return (
                      <div className="sc-cell-wrap" key={cellId}>
                        <div className={`sc-cell ${skill ? 'filled' : 'empty'}`} onClick={() => !skill && openPicker(q.key, i)}>
                          {skill ? (
                            <>
                              <img src={skill.image} alt={skill.name} />
                              <div className="sc-remove" onClick={(e) => { e.stopPropagation(); clearCell(cellId); }}><X size={11} /></div>
                            </>
                          ) : (
                            <Plus size={20} />
                          )}
                        </div>
                        {skill && <div className="sc-name">{skill.name}</div>}
                        {skill && showValues && (
                          <div className="sc-values">
                            <div className="sc-vrow">
                              <span className="sc-vlabel">DPS</span>
                              <div className="sc-vline">
                                <SignIcon value={cellData.normal} />
                                <input className="sc-vinput" type="number" placeholder="0" value={cellData.normal ?? ''}
                                  onChange={(e) => updateCellValue(cellId, 'normal', e.target.value)} />
                                <span className="sc-vpct">%</span>
                              </div>
                            </div>
                            {hasPotential && (
                              <div className="sc-vrow">
                                <span className="sc-vlabel">Potential</span>
                                <div className="sc-vline">
                                  <SignIcon value={cellData.potential} />
                                  <input className="sc-vinput" type="number" placeholder="0" value={cellData.potential ?? ''}
                                    onChange={(e) => updateCellValue(cellId, 'potential', e.target.value)} />
                                  <span className="sc-vpct">%</span>
                                </div>
                              </div>
                            )}
                            <div className="sc-addpot" onClick={() => togglePotential(cellId, !hasPotential)}>
                              {hasPotential ? '− potential' : '+ potential'}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sc-footer">
        Small details → Big difference · <span className="sc-reset" onClick={async () => {
          const ok = window.confirm("Delete all cells, the library, and settings? This can't be undone.");
          if (!ok) return;
          await persistLibrary([]);
          await persistLayout(DEFAULT_LAYOUT);
          persistBoard({});
          showToast('Everything reset');
        }}>reset everything</span>
      </div>

      {picker && (
        <div className="sc-overlay" onClick={() => setPicker(null)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-head">
              <div className="sc-heading sc-modal-title">{QUALITIES.find((q) => q.key === picker.quality)?.label}</div>
              <div className="sc-close" onClick={() => setPicker(null)}><X size={15} /></div>
            </div>
            {library.filter((s) => s.quality === picker.quality).length === 0 ? (
              <div className="sc-empty-msg">No icons of this rarity in the library yet.<br />Upload the first one below.</div>
            ) : (
              <div className="sc-picker-grid">
                {library.filter((s) => s.quality === picker.quality).map((s) => (
                  <div key={s.id} className="sc-pick-item" onClick={() => assignSkillToCell(picker.cellId, s.id)}>
                    <img src={s.image} alt={s.name} />
                  </div>
                ))}
              </div>
            )}
            <div className="sc-uploadbtn" onClick={() => openUploadFor('picker', picker.quality, picker.cellId)}>
              <Upload size={15} /> Upload new icon
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <div className="sc-overlay" onClick={() => setLibraryOpen(false)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-head">
              <div className="sc-heading sc-modal-title">Skill Library</div>
              <div className="sc-close" onClick={() => setLibraryOpen(false)}><X size={15} /></div>
            </div>
            <div className="sc-tabs">
              {QUALITIES.map((q) => (
                <div key={q.key} className="sc-tab"
                  style={libTab === q.key ? { background: q.accent, borderColor: q.accent, color: '#0a0e1a' } : {}}
                  onClick={() => setLibTab(q.key)}>
                  {q.short} ({library.filter((s) => s.quality === q.key).length})
                </div>
              ))}
            </div>
            <div className="sc-uploadbtn" style={{ marginBottom: 10 }} onClick={() => openUploadFor('library', libTab, null)}>
              <Upload size={15} /> Upload to {QUALITIES.find((q) => q.key === libTab)?.short}
            </div>
            {library.filter((s) => s.quality === libTab).length === 0 ? (
              <div className="sc-empty-msg">Empty for now</div>
            ) : (
              library.filter((s) => s.quality === libTab).map((s) => (
                <div key={s.id} className="sc-lib-row">
                  <div className="sc-lib-thumb"><img src={s.image} alt={s.name} /></div>
                  <input className="sc-lib-name" value={s.name} onChange={(e) => renameSkill(s.id, e.target.value)} />
                  <select className="sc-lib-select" value={s.quality} onChange={(e) => changeSkillQuality(s.id, e.target.value)}>
                    {QUALITIES.map((q) => <option key={q.key} value={q.key}>{q.short}</option>)}
                  </select>
                  <div className="sc-lib-del" onClick={() => deleteSkill(s.id)}><Trash2 size={15} /></div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {toast && <div className="sc-toast">{toast}</div>}
    </div>
  );
}
