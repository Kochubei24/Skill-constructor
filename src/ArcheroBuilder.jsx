import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, Upload, Trash2, Loader2, FolderOpen, Download } from 'lucide-react';
import { toPng } from 'html-to-image';
import { storage, uid, resizeImageFile } from './storage';

const EQUIPMENT_SLOTS = [
  { key: 'weapon', label: 'Weapon' },
  { key: 'helmet', label: 'Helmet' },
  { key: 'necklace', label: 'Necklace' },
  { key: 'chest', label: 'Armor' },
  { key: 'bracelet', label: 'Ring' },
  { key: 'boots', label: 'Boots' },
];

const ARCH_TABS = [
  { key: 'equipment', label: 'Equipment' },
  { key: 'runes', label: 'Runes' },
  { key: 'enchant', label: 'Enchantments' },
  { key: 'characters', label: 'Characters' },
];

const ACC = { accent: '#e0529c', accentDim: '#6b1f45', glow: 'rgba(224,82,156,0.35)' };

const EQ_LIB_KEY = 'equipment-library-v1';
const EQ_BOARD_KEY = 'equipment-board-v1';

export default function ArcheroBuilder() {
  const [tab, setTab] = useState('equipment');
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState([]);
  const [board, setBoard] = useState({});
  const [picker, setPicker] = useState(null); // slot key currently being filled
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libTab, setLibTab] = useState('weapon');
  const [toast, setToast] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);
  const uploadContext = useRef(null);
  const boardSaveTimer = useRef(null);
  const eqGridRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [lib, brd] = await Promise.all([
        storage.get(EQ_LIB_KEY).catch(() => null),
        storage.get(EQ_BOARD_KEY).catch(() => null),
      ]);
      try { if (lib) setLibrary(JSON.parse(lib.value)); } catch (e) {}
      try { if (brd) setBoard(JSON.parse(brd.value)); } catch (e) {}
      setLoading(false);
    })();
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const persistLibrary = useCallback(async (next) => {
    setLibrary(next);
    const res = await storage.set(EQ_LIB_KEY, JSON.stringify(next));
    if (!res) showToast('Failed to save the library');
  }, []);

  const persistBoard = useCallback((next) => {
    setBoard(next);
    if (boardSaveTimer.current) clearTimeout(boardSaveTimer.current);
    boardSaveTimer.current = setTimeout(async () => {
      const res = await storage.set(EQ_BOARD_KEY, JSON.stringify(next));
      if (!res) showToast('Failed to save progress');
    }, 500);
  }, []);

  const handleFileChosen = async (file) => {
    if (!file) return;
    const ctx = uploadContext.current;
    const targetSlot = ctx?.slot || 'weapon';
    try {
      const dataUrl = await resizeImageFile(file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Item';
      const item = { id: uid(), name, slot: targetSlot, image: dataUrl };
      const next = [...library, item];
      await persistLibrary(next);
      if (ctx?.mode === 'picker' && ctx.slotToFill) assignItemToSlot(ctx.slotToFill, item.id);
      showToast('Icon added');
    } catch (e) {
      showToast('Failed to upload image');
    }
    uploadContext.current = null;
  };

  const assignItemToSlot = (slotKey, itemId) => {
    const next = { ...board, [slotKey]: { itemId } };
    persistBoard(next);
    setPicker(null);
  };

  const clearSlot = (slotKey) => {
    const next = { ...board };
    delete next[slotKey];
    persistBoard(next);
  };

  const renameItem = (id, name) => persistLibrary(library.map((s) => (s.id === id ? { ...s, name } : s)));
  const changeItemSlot = (id, slot) => persistLibrary(library.map((s) => (s.id === id ? { ...s, slot } : s)));

  const deleteItem = (id) => {
    const ok = window.confirm('Delete this item from the library? It will be removed from its slot too.');
    if (!ok) return;
    persistLibrary(library.filter((s) => s.id !== id));
    const nb = { ...board };
    Object.keys(nb).forEach((k) => { if (nb[k]?.itemId === id) delete nb[k]; });
    persistBoard(nb);
  };

  const openPicker = (slotKey) => setPicker(slotKey);
  const openUploadFor = (mode, slot, slotToFill) => {
    uploadContext.current = { mode, slot, slotToFill };
    fileInputRef.current?.click();
  };

  const handleDownload = async () => {
    if (!eqGridRef.current || downloading) return;
    setDownloading(true);
    setExporting(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dataUrl = await toPng(eqGridRef.current, {
        backgroundColor: '#0a0e1a',
        pixelRatio: 3,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = 'equipment.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      showToast('Failed to export image');
    } finally {
      setExporting(false);
      setDownloading(false);
    }
  };

  const itemById = (id) => library.find((s) => s.id === id);
  const installedIds = Object.values(board).map((b) => b?.itemId).filter(Boolean);
  const pickerOptions = picker ? library.filter((s) => s.slot === picker && !installedIds.includes(s.id)) : [];

  if (loading) {
    return (
      <div style={{ minHeight: '30vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c88a8', fontFamily: 'Inter, sans-serif' }}>
        <Loader2 className="spin" size={20} style={{ marginRight: 8 }} /> Loading…
      </div>
    );
  }

  return (
    <div className="ab-root">
      <style>{`
        .ab-root, .ab-root * { box-sizing: border-box; }
        .ab-tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 16px; padding-bottom: 2px; }
        .ab-tab { flex-shrink: 0; padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid #26314d; background: #131c33; color: #8b96b8; white-space: nowrap; }
        .ab-tab.active { background: ${ACC.accent}; border-color: ${ACC.accent}; color: #1a0a14; }
        .ab-tab.disabled { opacity: 0.45; }
        .ab-actions { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .ab-libbtn { display: flex; align-items: center; gap: 6px; background: #131c33; border: 1px solid #26314d; color: #e7ecf7; padding: 8px 12px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .ab-libbtn:active { transform: scale(0.97); }
        .ab-libbtn.disabled { opacity: 0.6; pointer-events: none; }
        .ab-eq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 420px; margin: 4px auto 0; }
        .ab-eq-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border-radius: 16px; padding: 12px; position: relative; aspect-ratio: 1; overflow: hidden; }
        .ab-eq-card.empty { border: 1.5px dashed ${ACC.accentDim}; background: #0c1220; cursor: pointer; color: ${ACC.accentDim}; }
        .ab-eq-card.empty:active { background: #101a30; }
        .ab-eq-card.filled { border: none; padding: 0; background: #0c1220; box-shadow: 0 0 12px ${ACC.glow}; cursor: pointer; }
        .ab-eq-card.filled:active { opacity: 0.9; }
        .ab-eq-icon { width: 100%; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 10px; }
        .ab-eq-icon img { width: 100%; height: 100%; object-fit: contain; }
        .ab-eq-card.filled .ab-eq-icon { position: absolute; inset: 0; border-radius: 16px; }
        .ab-eq-card.filled .ab-eq-icon img { object-fit: cover; }
        .ab-eq-label { font-size: 11.5px; font-weight: 600; color: #9aa5c4; text-transform: uppercase; letter-spacing: 0.02em; }
        .ab-eq-remove { position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border-radius: 6px; background: rgba(10,14,26,0.85); border: 1px solid #26314d; color: #cfd6e8; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2; }
        .ab-exporting .ab-eq-remove { display: none; }
        .ab-empty-msg { font-size: 12.5px; color: #5b6784; text-align: center; padding: 18px 6px; line-height: 1.5; }
        .ab-soon { text-align: center; padding: 50px 20px; color: #5b6784; font-size: 13.5px; line-height: 1.6; }
        .ab-overlay { position: fixed; inset: 0; background: rgba(6,9,18,0.82); display: flex; align-items: flex-end; justify-content: center; z-index: 50; }
        .ab-modal { background: #10182c; width: 100%; max-width: 520px; max-height: 82vh; border-radius: 18px 18px 0 0; padding: 16px; overflow-y: auto; border: 1px solid #26314d; border-bottom: none; }
        .ab-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .ab-modal-title { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 17px; color: #e7ecf7; }
        .ab-close { width: 30px; height: 30px; border-radius: 9px; background: #1a2338; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #cfd6e8; flex-shrink: 0; }
        .ab-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; margin-bottom: 14px; }
        .ab-pick-item { aspect-ratio: 1; border-radius: 9px; background: #0c1220; border: 1px solid #26314d; display: flex; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; }
        .ab-pick-item img { width: 100%; height: 100%; object-fit: contain; padding: 5px; }
        .ab-pick-item:active { border-color: #5b6784; }
        .ab-uploadbtn { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; padding: 11px; border-radius: 10px; border: 1px dashed #3a4666; color: #9aa5c4; font-size: 13px; font-weight: 600; cursor: pointer; background: #0c1220; }
        .ab-lib-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-bottom: 1px solid #1a2338; }
        .ab-lib-thumb { width: 40px; height: 40px; border-radius: 8px; background: #0c1220; border: 1px solid #26314d; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .ab-lib-thumb img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
        .ab-lib-name { flex: 1; min-width: 0; background: transparent; border: none; border-bottom: 1px solid transparent; color: #e7ecf7; font-size: 13px; padding: 3px 2px; }
        .ab-lib-name:focus { outline: none; border-bottom-color: #5b6784; }
        .ab-lib-select { background: #0c1220; border: 1px solid #26314d; color: #cfd6e8; font-size: 11px; border-radius: 6px; padding: 3px 4px; flex-shrink: 0; }
        .ab-lib-del { color: #f26d6d; cursor: pointer; padding: 4px; flex-shrink: 0; }
        .ab-toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: #1a2338; border: 1px solid #2e3a5c; color: #e7ecf7; padding: 9px 16px; border-radius: 10px; font-size: 12.5px; z-index: 80; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
      `}</style>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; handleFileChosen(f); e.target.value = ''; }} />

      <div className="ab-tabs">
        {ARCH_TABS.map((t) => (
          <div key={t.key} className={`ab-tab ${tab === t.key ? 'active' : ''} ${t.key !== 'equipment' ? 'disabled' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'equipment' && (
        <>
          <div className="ab-actions">
            <div className="ab-libbtn" onClick={() => setLibraryOpen(true)}>
              <FolderOpen size={15} /> Library
            </div>
            <div className={`ab-libbtn ${downloading ? 'disabled' : ''}`} onClick={handleDownload}>
              {downloading ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download
            </div>
          </div>

          <div ref={eqGridRef} className={`ab-eq-grid ${exporting ? 'ab-exporting' : ''}`}>
            {EQUIPMENT_SLOTS.map((slot) => {
              const cellData = board[slot.key];
              const item = cellData ? itemById(cellData.itemId) : null;
              return (
                <div key={slot.key} className={`ab-eq-card ${item ? 'filled' : 'empty'}`}
                  onClick={() => openPicker(slot.key)}>
                  {item ? (
                    <>
                      <div className="ab-eq-icon"><img src={item.image} alt={item.name} /></div>
                      <div className="ab-eq-remove" onClick={(e) => { e.stopPropagation(); clearSlot(slot.key); }}><X size={12} /></div>
                    </>
                  ) : (
                    <>
                      <Plus size={20} />
                      <div className="ab-eq-label">{slot.label}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab !== 'equipment' && (
        <div className="ab-soon">
          {ARCH_TABS.find((t) => t.key === tab)?.label} — coming soon
        </div>
      )}

      {picker && (
        <div className="ab-overlay" onClick={() => setPicker(null)}>
          <div className="ab-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ab-modal-head">
              <div className="ab-modal-title">{EQUIPMENT_SLOTS.find((s) => s.key === picker)?.label}</div>
              <div className="ab-close" onClick={() => setPicker(null)}><X size={15} /></div>
            </div>
            {pickerOptions.length === 0 ? (
              <div className="ab-empty-msg">No available icons for this slot.<br />Upload a new one below.</div>
            ) : (
              <div className="ab-picker-grid">
                {pickerOptions.map((s) => (
                  <div key={s.id} className="ab-pick-item" onClick={() => assignItemToSlot(picker, s.id)}>
                    <img src={s.image} alt={s.name} />
                  </div>
                ))}
              </div>
            )}
            <div className="ab-uploadbtn" onClick={() => openUploadFor('picker', picker, picker)}>
              <Upload size={15} /> Upload new icon
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <div className="ab-overlay" onClick={() => setLibraryOpen(false)}>
          <div className="ab-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ab-modal-head">
              <div className="ab-modal-title">Equipment Library</div>
              <div className="ab-close" onClick={() => setLibraryOpen(false)}><X size={15} /></div>
            </div>
            <div className="ab-tabs">
              {EQUIPMENT_SLOTS.map((s) => (
                <div key={s.key} className={`ab-tab ${libTab === s.key ? 'active' : ''}`}
                  onClick={() => setLibTab(s.key)}>
                  {s.label} ({library.filter((it) => it.slot === s.key).length})
                </div>
              ))}
            </div>
            <div className="ab-uploadbtn" style={{ marginBottom: 10 }} onClick={() => openUploadFor('library', libTab, null)}>
              <Upload size={15} /> Upload to {EQUIPMENT_SLOTS.find((s) => s.key === libTab)?.label}
            </div>
            {library.filter((s) => s.slot === libTab).length === 0 ? (
              <div className="ab-empty-msg">Empty for now</div>
            ) : (
              library.filter((s) => s.slot === libTab).map((s) => (
                <div key={s.id} className="ab-lib-row">
                  <div className="ab-lib-thumb"><img src={s.image} alt={s.name} /></div>
                  <input className="ab-lib-name" value={s.name} onChange={(e) => renameItem(s.id, e.target.value)} />
                  <select className="ab-lib-select" value={s.slot} onChange={(e) => changeItemSlot(s.id, e.target.value)}>
                    {EQUIPMENT_SLOTS.map((sl) => <option key={sl.key} value={sl.key}>{sl.label}</option>)}
                  </select>
                  <div className="ab-lib-del" onClick={() => deleteItem(s.id)}><Trash2 size={15} /></div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {toast && <div className="ab-toast">{toast}</div>}
    </div>
  );
}
