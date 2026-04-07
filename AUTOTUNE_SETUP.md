# 🎤 Autotune T-Pain – Backend Setup Guide

## 📋 Requirements

### Python 3.8+
```bash
# Check Python version
python --version
```

### Required Python Libraries
- `librosa` – Audio signal processing + YIN pitch detection
- `soundfile` – Audio file I/O (WAV, FLAC, OGG, etc.)
- `numpy` – Numerical computing
- `scipy` – Scientific computing (for signal processing)

---

## 🔧 Installation Steps

### 1. Install Python (if not already installed)

**Windows:**
```bash
# Download from https://www.python.org/downloads/
# Make sure to check "Add Python to PATH" during installation

# Verify installation
python --version
pip --version
```

**macOS/Linux:**
```bash
brew install python3
# or
sudo apt-get install python3 python3-pip
```

---

### 2. Install Required Libraries

**Create a virtual environment (recommended):**
```bash
cd backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

**Install dependencies:**
```bash
pip install librosa soundfile numpy scipy

# Or install from requirements file (create if needed):
pip freeze > requirements.txt
pip install -r requirements.txt
```

**Verify installation:**
```bash
python -c "import librosa; import soundfile; print('✓ All libraries installed')"
```

---

### 3. Test the Autotune Service

**Test script to generate a sample:**
```bash
# Generate test audio (sine wave)
python -c "
import soundfile as sf
import numpy as np

sr = 44100
duration = 3
freq = 220  # La3
t = np.linspace(0, duration, int(sr * duration))
audio = np.sin(2 * np.pi * freq * t) * 0.3
sf.write('test_input.wav', audio, sr)
print('✓ Created test_input.wav')
"

# Apply autotune
python services/autotune.service.py test_input.wav test_output.wav 1.0 major 0

# Check result
ls -la test_output.wav
```

---

### 4. Integrate with Node.js Backend

The Node.js wrapper automatically calls the Python service:

```javascript
// In studio.controller.js – already integrated!
const { applyAutotune } = require('../services/autotune');

// When renderMix() is called with autotune effect:
if (autotuneAmount > 0.05) {
  await applyAutotune({
    inputPath: mixPath,
    outputPath: autotuneOutputPath,
    strength: autotuneAmount,
    scale: 'major',
    rootNote: 0
  });
}
```

---

## 🎛️ Frontend Parameters vs Backend Processing

### Frontend (mobile app):
```dart
final effects = {
  'autotune': 0.85,           // Correction strength (0-1)
  'autotune_scale': 'major',  // OPTIONAL: Musical scale
  'autotune_rootNote': 0,     // OPTIONAL: Root note (0-11)
  'autotune_wetMix': 1.0,     // OPTIONAL: Wet/dry mix
};
```

### Backend Processing:
```javascript
// Extracted in studio.controller.js
const scaleName = effects.autotune_scale || 'major';
const rootNote = Math.round(effects.autotune_rootNote ?? 0);

// Passed to Python
await applyAutotune({
  strength: autotuneAmount,      // 0.85
  scale: scaleName,               // 'major'
  rootNote: rootNote              // 0
});
```

---

## 📊 Autotune Algorithm

### 1. **Pitch Detection (YIN)**
```
Audio → FFT → YIN algorithm → Detected frequency (Hz)
```

### 2. **Note Snapping**
```
Frequency (Hz) → MIDI note → Snap to scale → Target MIDI note
Example: 215 Hz → "La#3" → snap to major scale → "Si3"
```

### 3. **Pitch Shifting (Phase Vocoder)**
```
Original audio → Phase vocoder → Shifted to target pitch → Output
```

### 4. **Wet/Dry Mix**
```
Output = (Original × (1 - strength)) + (Shifted × strength)
```

---

## 🚨 Troubleshooting

### Error: `ModuleNotFoundError: No module named 'librosa'`
```bash
# Install librosa explicitly
pip install librosa

# Or upgrade pip first
pip install --upgrade pip
pip install librosa
```

### Error: `Python not found` (Node.js spawning)
```bash
# Make sure Python is in PATH
python --version

# Or specify full Python path in Node.js
spawn('C:\\Python39\\python.exe', [...])
```

### Error: `librosa taking too long`
```python
# librosa first load is slow (300-500ms)
# Subsequent calls are fast due to caching
# This is normal behavior
```

### Performance Issues
- **YIN detection is CPU-intensive**: ~100-200ms per frame for 3-minute audio
- **For shorter clips** (<30s): No problem
- **For longer clips** (>5 min): Consider background processing

---

## 🎯 Optional: Use FFmpeg's native pitch shift (faster)

If Python/librosa unavailable, backend falls back to FFmpeg chorus effect (already in code).

**To force chorus fallback:**
```javascript
// Comment out autotune application in audioMix.service.js
if (autotuneAmount > 0.05 && USE_CHORUS) {
  vocalFilters.push(`chorus=0.5:0.9:${delay}:${decay}:${speed}:${depth}`);
}
```

---

## ✅ Installation Checklist

- [ ] Python 3.8+ installed
- [ ] `librosa` installed
- [ ] `soundfile` installed
- [ ] `numpy` installed
- [ ] `scipy` installed
- [ ] Test script runs successfully
- [ ] Backend compiles without errors
- [ ] Frontend exports with autotune > 0
- [ ] Check backend logs for `[AUTOTUNE]` messages

---

## 📝 Environment Variables (Optional)

Add to `.env` if needed:
```env
# Python executable path (auto-detected if in PATH)
PYTHON_PATH=python

# Enable/disable autotune processing
ENABLE_AUTOTUNE=true

# Autotune processing timeout (ms)
AUTOTUNE_TIMEOUT=120000
```

---

## 🚀 Production Deployment

**Docker setup (recommended):**
```dockerfile
FROM node:18-bullseye

# Install Python
RUN apt-get update && apt-get install -y python3 python3-pip

# Install Python deps
COPY requirements.txt /app/
RUN pip install -r /app/requirements.txt

# Install Node deps
COPY package.json /app/
RUN npm install

# Start server
CMD ["npm", "start"]
```

**docker-compose.yml:**
```yaml
services:
  backend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://...
```

---

**Date**: April 7, 2026  
**Status**: ✅ Production-ready  
**Tested**: ✅ Yes
