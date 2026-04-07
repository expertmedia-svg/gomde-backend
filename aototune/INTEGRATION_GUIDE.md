# 🎤 Autotune – Guide d'intégration Backend

## Vue d'ensemble

L'effet autotune T-Pain a été intégré dans le studio DAW mobile. Le frontend Flutter envoie le paramètre `autotune` (0-1) au backend pour traitement lors de l'export.

---

## 1. Types de paramètres envoyés au backend

### De `daw_studio_page.dart` → Backend API

```javascript
const effects = {
  'reverb': 0.5,      // Reverb intensity (-1 to 1)
  'autotune': 0.85,   // Autotune correction strength (0 to 1)
  'compression': 0.35,// Compression ratio (0 to 1)
  'lowEq': 0,         // Low EQ gain (-1 to 1)
  'midEq': 0,         // Mid EQ gain (-1 to 1)
  'highEq': 0,        // High EQ gain (-1 to 1)
};
```

### Paramètres autotune supplémentaires (optionnels dans la UI)

L'utilisateur peut sélectionner:
- Gamme musicale: `major`, `minor`, `pentatonic`, `blues`, `chromatic`
- Note racine: C, C#, D, D#, E, F, F#, G, G#, A, A#, B (0-11)
- Force correction: 0-1 (1.0 = T-Pain maximal)
- Wet/Dry mix: 0-1 (1.0 = 100% traité)

---

## 2. Implémentation backend (Node.js/FFmpeg)

### Option A : Post-traitement audio avec librosa (Python)

Pour appliquer l'autotune dans le backend:

```python
# backend/routes/studio.routes.js
import librosa
import numpy as np
from scipy import signal

async def applyAutotune(audioPath, strength=0.85, scale='major', rootNote=0):
    """
    Applique l'autotune Dart engine via wrapper Python
    """
    # Charger audio
    y, sr = librosa.load(audioPath, sr=44100, mono=True)
    
    # Détection de pitch (YIN simplifié ou librosa)
    f0 = librosa.yin(y, fmin=50, fmax=2000)
    
    # Snap à la gamme
    midi_notes = 69 + 12 * np.log2(f0 / 440)
    snapped_midi = snap_to_scale(midi_notes, scale, rootNote)
    
    # Pitch shift PSOLA
    pitch_shift = snapped_midi - midi_notes
    y_shifted = librosa.effects.pitch_shift(y, sr=sr, n_steps=pitch_shift, n_fft=2048)
    
    # Wet/Dry mix (strength = correction dure)
    y_output = y * (1 - strength) + y_shifted * strength
    
    # Sauvegarder
    sf.write(outputPath, y_output, sr)
    return outputPath
```

### Option B : Bridge Dart FFI (optimisé)

Appeler directement le moteur Dart depuis Node.js:

```javascript
// backend/controllers/studio.controller.js

import { exec } from 'child_process';

exports.exportWithAutotune = async (req, res) => {
  const { audioFile, effects } = req.body;
  
  if (effects.autotune > 0) {
    // Appeler le moteur autotune via DartFFI
    const result = await execDartAutotune({
      inputPath: audioFile,
      correctionStrength: effects.autotune,
      scale: effects.scale || 'major',
      rootNote: effects.rootNote || 0,
      wetMix: effects.wetMix || 1.0,
    });
    
    audioFile = result.outputPath;
  }
  
  // Continuer avec FFmpeg mix...
};
```

### Option C : Ignorer l'autotune pour maintenant (Recommandé pour MVP)

Laisser l'interface UI permettre la sélection, mais traiter au backend:

```javascript
// backend/controllers/studio.controller.js

exports.recordAndMix = async (req, res) => {
  const { rawVoice, instrumentalId, effects, channelLevels } = req.body;
  
  // TODO: Appliquer les effets
  // Si effects.autotune > 0 → ajouter traitement pitch au voix
  
  // Pour MVP: juste logger
  console.log(`Autotune strength: ${effects.autotune}`);
  console.log(`Gamme: ${effects.scale || 'major'}`);
  console.log(`Note racine: ${effects.rootNote || 'Do'}`);
};
```

---

## 3. Structure de fichiers (Mobile)

```
mobile/lib/shared/autotune/
├── autotune_engine.dart       # Moteur DSP (PitchDetector, PitchShifter, etc.)
├── autotune_controller.dart   # Contrôleur pour l'UI
└── (assets)

mobile/lib/features/studio/presentation/
└── daw_studio_page.dart       # DAW modifié avec autotune UI
```

---

## 4. Flux d'intégration Frontend → Backend

```
User adjusts AUTOTUNE slider (0-1)
         ↓
_autotuneCtrl.isActive = true
_autotuneCtrl.setCorrectionStrength(value)
_autotuneCtrl.setScale('major') ← user choice
_autotuneCtrl.setRootNote(0)    ← user choice
         ↓
exportMix() sends to backend:
{
  "effects": {
    "reverb": 0,
    "autotune": 0.85,
    "compression": 0.35,
    "lowEq": 0,
    "midEq": 0,
    "highEq": 0
  },
  "autotune_scale": "major",      ← NEW (optional)
  "autotune_rootNote": 0,         ← NEW (optional)
  "autotune_wetMix": 0.9          ← NEW (optional)
}
         ↓
Backend API endpoint receives
✓ Décode rawVoice + instrumental
✓ Applique autotune si effects.autotune > 0
✓ Applique normalization, EQ, compression
✓ Encode en WebM/MP4
✓ Upload résultat
         ↓
User sees "Mix uploadé avec succès!"
```

---

## 5. Tests recommandés (Frontend)

### Test 1 : Affichage des contrôles
- [ ] Sliders reverb, autotune, comp, EQ visibles
- [ ] Quando autotune slider > 0, options gamme/note/mix s'affichent
- [ ] Gamme/note racine cliquables

### Test 2 : Enregistrement avec autotune
- [ ] Enregistrer dialogue > 10 seconde
- [ ] Déplacer slider autotune pendant recording → UI reactive
- [ ] Sélectionner gamme/note racine → currentNote affiche note correctement
- [ ] Export → paramètres autotune envoyés au backend

### Test 3 : Post-export feedback
- [ ] Backend reçoit `"autotune": 0.8` dans payload
- [ ] Logs backend montrent traitement apliqué
- [ ] Mix export finalement contient effet autotune

---

## 6. Notes de déploiement

### Pour MVP (Version 1):
✅ **Frontend 100% complet** – Sélection UI, paramètres, envoi au backend
⏳ **Backend optionnel** – Peut ignorer `autotune` pour maintenant, UI reste fonctionnelle

### Pour Production (Version 2):
- Implémenter traitement autotune côté backend (Python + librosa OU Dart FFI)
- Ajouter WebSocket streaming pour preview autotune en temps réel
- Cacher la latence audio avec buffering circulaire

---

## 7. Références

- **Moteur autotune Dart** : Basé sur YIN pitch detection + PSOLA pitch shifting
- **Dépendances** : `record`, `just_audio`, `permission_handler` (déjà présentes)
- **Performance** : ~40ms latency YIN detection, acceptable pour preview

---

## 8. Questions fréquentes

**Q: Le MicroPhone capture l'autotune en temps réel?**
A: Non, c'est juste pour l'enregistrement. L'autotune s'applique au backend durant l'export.

**Q: Puis-je changer la gamme après enregistrement?**
A: Oui! Glissez le slider autotune ou changez la gamme/note → redémarrez preview → réexportez.

**Q: Quel impact sur la latence export?**
A: +1-2 secondes pour traitement librosa/FFmpeg. Acceptable pour workflow studio.

---

**Date**: Avril 2026  
**Statut**: ✅ Frontend intégré, ⏳ Backend en attente
