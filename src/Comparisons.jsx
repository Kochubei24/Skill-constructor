// NOTE: this component is only ever rendered inside ArcheroBuilder (as the
// "compare" tab), and intentionally reuses several class names that
// ArcheroBuilder's own <style> tag already defines globally: ab-eq-grid,
// ab-eq-card, ab-eq-icon, ab-eq-remove, ab-eq-label, ab-libbtn, ab-overlay,
// ab-modal, ab-modal-head, ab-modal-title, ab-close, ab-picker-grid,
// ab-pick-item, ab-empty-msg, ab-uploadbtn. If this file is ever rendered on
// its own those styles won't exist and it needs its own copies.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Trash2, Loader2, Download, Upload } from 'lucide-react';
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

const EQ_LIB_KEY = 'equipment-library-v1';
const COMPARE_KEY = 'compare-sets-v1';

const emptySet = () => ({ board: {}, advantages: [] });
const DEFAULT_SETS = [emptySet(), emptySet(), emptySet()];

export default function Comparisons() {
  const [loading, setLoading] = useState(true);
  const [eqLibrary, setEqLibrary] = useState([]);
  const [sets, setSets] = useState(DEFAULT_SETS);
  const [picker, setPicker] = useState(null); // { setIndex, slotKey }
  const [toast, setToast] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const saveTimer = useRef(null);
  const wrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadContext = useRef(null);

  useEffect(() => {
    (async () => {
      const [lib, cmp] = await Promise.all([
        storage.get(EQ_LIB_KEY).catch(() => null),
        storage.get(COMPARE_KEY).catch(() => null),
      ]);
      try { if (lib) setEqLibrary(JSON.parse(lib.value)); } catch (e) {}
      try {
        if (cmp) {
          const parsed = JSON.parse(cmp.value);
          if (Array.isArray(parsed) && parsed.length === 3) setSets(parsed);
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const persistLibrary = useCallback(async (next) => {
    setEqLibrary(next);
    const res = await storage.set(EQ_LIB_KEY, JSON.stringify(next));
    if (!res) showToast('Failed to save the library');
  }, []);

  const persistSets = useCallback((next) => {
    setSets(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await storage.set(COMPARE_KEY, JSON.stringify(next));
      if (!res) showToast('Failed to save progress');
    }, 500);
  }, []);

  const itemById = (id) => eqLibrary.find((s) => s.id === id);

  const assignItem = (setIndex, slotKey, itemId) => {
    const next = sets.map((s, i) => i === setIndex ? { ...s, board: { ...s.board, [slotKey]: { itemId } } } : s);
    persistSets(next);
    setPicker(null);
  };

  const clearSlot = (setIndex, slotKey) => {
    const next = sets.map((s, i) => {
      if (i !== setIndex) return s;
      const board = { ...s.board };
      delete board[slotKey];
      return { ...s, board };
    });
    persistSets(next);
  };

  const addRow = (setIndex) => {
    const next = sets.map((s, i) => i === setIndex
      ? { ...s, advantages: [...s.advantages, { id: uid(), text: '', mark: 'check' }] }
      : s);
    persistSets(next);
  };

  const updateRowText = (setIndex, rowId, text) => {
    const next = sets.map((s, i) => i === setIndex
      ? { ...s, advantages: s.advantages.map((r) => (r.id === rowId ? { ...r, text } : r)) }
      : s);
    persistSets(next);
  };

  const toggleRowMark = (setIndex, rowId) => {
    const next = sets.map((s, i) => i === setIndex
      ? { ...s, advantages: s.advantages.map((r) => (r.id === rowId ? { ...r, mark: r.mark === 'check' ? 'cross' : 'check' } : r)) }
      : s);
    persistSets(next);
  };

  const deleteRow = (setIndex, rowId) => {
    const next = sets.map((s, i) => i === setIndex
      ? { ...s, advantages: s.advantages.filter((r) => r.id !== rowId) }
      : s);
    persistSets(next);
  };

  const openPicker = (setIndex, slotKey) => setPicker({ setIndex, slotKey });
  const openUploadFor = (setIndex, slotKey) => {
    uploadContext.current = { setIndex, slotKey };
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (file) => {
    if (!file) return;
    const ctx = uploadContext.current;
    const targetSlot = ctx?.slotKey || 'weapon';
    try {
      const dataUrl = await resizeImageFile(file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Item';
      const item = { id: uid(), name, slot: targetSlot, image: dataUrl };
      const nextLib = [...eqLibrary, item];
      await persistLibrary(nextLib);
      if (ctx?.setIndex !== undefined) assignItem(ctx.setIndex, targetSlot, item.id);
      showToast('Icon added');
    } catch (e) {
      showToast('Failed to upload image');
    }
    uploadContext.current = null;
  };

  const isSetEmpty = (setIndex) => Object.keys(sets[setIndex].board).length === 0;

  const handleDownload = async () => {
    if (!wrapRef.current || downloading) return;
    if (sets.every((_, i) => isSetEmpty(i))) { showToast('Add equipment to at least one set first'); return; }
    setDownloading(true);
    setExporting(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dataUrl = await toPng(wrapRef.current, {
        backgroundColor: '#0a0e1a',
        pixelRatio: 3,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = 'comparison.png';
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

  if (loading) {
    return (
      <div style={{ minHeight: '30vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c88a8', fontFamily: 'Inter, sans-serif' }}>
        <Loader2 className="spin" size={20} style={{ marginRight: 8 }} /> Loading…
      </div>
    );
  }

  const sectionInstalledIds = picker
    ? Object.values(sets[picker.setIndex]?.board || {}).map((b) => b?.itemId).filter(Boolean)
    : [];
  const pickerOptions = picker
    ? eqLibrary.filter((s) => s.slot === picker.slotKey && !sectionInstalledIds.includes(s.id))
    : [];

  return (
    <div className="cmp-root">
      <style>{`
        .cmp-root, .cmp-root * { box-sizing: border-box; }
        .cmp-actions { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .cmp-section { border-radius: 16px; padding: 14px 12px 16px; margin-bottom: 18px; border: 1px solid #2a2140; background: linear-gradient(180deg, rgba(224,82,156,0.08) 0%, #0d1424 100%); }
        .cmp-section-hidden-export { display: none !important; }
        .cmp-section-title { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 15px; color: #e0529c; margin-bottom: 10px; letter-spacing: 0.02em; }
        .cmp-adv-title { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 13px; color: #9aa5c4; text-transform: uppercase; letter-spacing: 0.03em; margin: 16px 0 8px; }
        .cmp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .cmp-mark { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; cursor: pointer; flex-shrink: 0; user-select: none; }
        .cmp-mark.check { background: rgba(74,222,128,0.15); color: #4ade80; border: 1px solid rgba(74,222,128,0.4); }
        .cmp-mark.cross { background: rgba(248,113,113,0.15); color: #f87171; border: 1px solid rgba(248,113,113,0.4); }
        .cmp-row-input { flex: 1; min-width: 0; background: #0c1220; border: 1px solid #26314d; border-radius: 8px; color: #e7ecf7; font-size: 13px; padding: 7px 9px; font-family: inherit; }
        .cmp-row-input:focus { outline: none; border-color: #5b6784; }
        .cmp-row-del { color: #5b6784; cursor: pointer; padding: 4px; flex-shrink: 0; }
        .cmp-row-del:active { color: #f26d6d; }
        .cmp-exporting .cmp-row-del, .cmp-exporting .cmp-addrow, .cmp-exporting .ab-eq-remove { display: none; }
        .cmp-addrow { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 8px; border-radius: 8px; border: 1px dashed #3a4666; color: #9aa5c4; font-size: 12.5px; font-weight: 600; cursor: pointer; background: #0c1220; margin-top: 4px; }
        .cmp-empty-set-msg { font-size: 12px; color: #5b6784; text-align: center; padding: 8px; }
        .cmp-toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: #1a2338; border: 1px solid #2e3a5c; color: #e7ecf7; padding: 9px 16px; border-radius: 10px; font-size: 12.5px; z-index: 80; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
      `}</style>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; handleFileChosen(f); e.target.value = ''; }} />

      <div className="cmp-actions">
        <div className={`ab-libbtn ${downloading ? 'disabled' : ''}`} onClick={handleDownload}>
          {downloading ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download
        </div>
      </div>

      <div ref={wrapRef} className={exporting ? 'cmp-exporting' : ''}>
        {sets.map((set, setIndex) => {
          const empty = isSetEmpty(setIndex);
          return (
            <div key={setIndex} className={`cmp-section ${exporting && empty ? 'cmp-section-hidden-export' : ''}`}>
              <div className="cmp-section-title">Set {setIndex + 1}</div>

              <div className="ab-eq-grid">
                {EQUIPMENT_SLOTS.map((slot) => {
                  const cellData = set.board[slot.key];
                  const item = cellData ? itemById(cellData.itemId) : null;
                  return (
                    <div key={slot.key} className={`ab-eq-card ${item ? 'filled' : 'empty'}`}
                      onClick={() => openPicker(setIndex, slot.key)}>
                      {item ? (
                        <>
                          <div className="ab-eq-icon"><img src={item.image} alt={item.name} /></div>
                          <div className="ab-eq-remove" onClick={(e) => { e.stopPropagation(); clearSlot(setIndex, slot.key); }}><X size={12} /></div>
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

              <div className="cmp-adv-title">Advantages</div>
              {set.advantages.length === 0 ? (
                <div className="cmp-empty-set-msg">No lines yet</div>
              ) : (
                set.advantages.map((row) => (
                  <div key={row.id} className="cmp-row">
                    <div className={`cmp-mark ${row.mark}`} onClick={() => toggleRowMark(setIndex, row.id)}>
                      {row.mark === 'check' ? '✓' : '×'}
                    </div>
                    <input className="cmp-row-input" type="text" placeholder="Describe an advantage or drawback…"
                      value={row.text} onChange={(e) => updateRowText(setIndex, row.id, e.target.value)} />
                    <div className="cmp-row-del" onClick={() => deleteRow(setIndex, row.id)}><Trash2 size={14} /></div>
                  </div>
                ))
              )}
              <div className="cmp-addrow" onClick={() => addRow(setIndex)}>
                <Plus size={13} /> Add line
              </div>
            </div>
          );
        })}
      </div>

      {picker && (
        <div className="ab-overlay" onClick={() => setPicker(null)}>
          <div className="ab-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ab-modal-head">
              <div className="ab-modal-title">{EQUIPMENT_SLOTS.find((s) => s.key === picker.slotKey)?.label} — Set {picker.setIndex + 1}</div>
              <div className="ab-close" onClick={() => setPicker(null)}><X size={15} /></div>
            </div>
            {pickerOptions.length === 0 ? (
              <div className="ab-empty-msg">No available icons for this slot.<br />Upload a new one below.</div>
            ) : (
              <div className="ab-picker-grid">
                {pickerOptions.map((s) => (
                  <div key={s.id} className="ab-pick-item" onClick={() => assignItem(picker.setIndex, picker.slotKey, s.id)}>
                    <img src={s.image} alt={s.name} />
                  </div>
                ))}
              </div>
            )}
            <div className="ab-uploadbtn" onClick={() => openUploadFor(picker.setIndex, picker.slotKey)}>
              <Upload size={15} /> Upload new icon
            </div>
          </div>
        </div>
      )}

      {toast && <div className="cmp-toast">{toast}</div>}
    </div>
  );
}
