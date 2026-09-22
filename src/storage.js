// Simple localStorage-backed storage, mirrors the shape of the Claude-artifact
// window.storage API (get/set returning {key, value}) so component logic
// doesn't need to change if it ever moves between environments.
export const storage = {
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

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function resizeImageFile(file, maxSize = 160) {
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
