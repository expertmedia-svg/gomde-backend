# 🎤 Autotune T-Pain Effect – Guide d'intégration Flutter

## Fichiers fournis
- `autotune_engine.dart` – Moteur DSP (traitement audio)
- `autotune_widget.dart` – Interface Flutter complète

---

## 1. Dépendances à ajouter dans pubspec.yaml

```yaml
dependencies:
  flutter:
    sdk: flutter
  record: ^5.0.0            # Capture audio micro
  flutter_sound: ^9.2.13    # Lecture + enregistrement audio
  just_audio: ^0.9.38       # Lecture PCM en temps réel
  permission_handler: ^11.0.0
```

---

## 2. Permissions Android (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>
```

## 3. Permissions iOS (Info.plist)

```xml
<key>NSMicrophoneUsageDescription</key>
<string>L'app a besoin du micro pour l'effet autotune</string>
```

---

## 4. Connexion micro réel → AutotuneEngine

Remplace `FakeAudioStream` dans `autotune_widget.dart` par ce code :

```dart
import 'package:record/record.dart';
import 'package:flutter_sound/flutter_sound.dart';

// Dans AutotuneController :
final _recorder = AudioRecorder();
final _player = FlutterSoundPlayer();

Future<void> toggleReal() async {
  if (!isActive) {
    await _player.openPlayer();
    await _player.startPlayerFromStream(
      codec: Codec.pcm16,
      numChannels: 1,
      sampleRate: 44100,
    );
    await _recorder.startStream(
      const RecordConfig(encoder: AudioEncoder.pcm16bits, sampleRate: 44100)
    );
    _recorder.onAmplitudeChanged(interval).listen((_) {});
    _sub = _recorder.onData().listen((data) {
      // data = Uint8List → convertir en Int16List
      final pcm = data.buffer.asInt16List();
      final processed = _engine.process(pcm);
      // Envoyer vers le player
      _player.feedFromStream(processed.buffer.asUint8List());
    });
    isActive = true;
  } else {
    await _recorder.stop();
    await _player.stopPlayer();
    isActive = false;
  }
}
```

---

## 5. Comment ça marche (algorithme T-Pain)

```
Micro → Buffer PCM16 → [YIN Pitch Detection] → Fréquence Hz
                                                      ↓
                                            MIDI = 69 + 12×log₂(Hz/440)
                                                      ↓
                                       [Snap à la gamme choisie]
                                       (correctionStrength = 1.0 = T-Pain)
                                                      ↓
                                       [PSOLA Pitch Shifting]
                                       factor = targetHz / detectedHz
                                                      ↓
                                       [Wet/Dry Mix] → Speaker
```

---

## 6. Paramètres clés

| Paramètre | Valeur T-Pain | Description |
|---|---|---|
| `correctionStrength` | 1.0 | Snap dur à la note (effet robotique) |
| `wetMix` | 1.0 | 100% signal traité |
| `scaleName` | 'major' | Gamme majeure recommandée |
| `rootNote` | 0 (Do) | Changer selon la tonalité de ta chanson |

---

## 7. Envoyer à ton IA

Pour envoyer le moteur à ton IA, inclus ce prompt :

```
Voici mon moteur autotune Dart (autotune_engine.dart).
Intègre AutotuneEngine dans [NOM DE TON APP].
- Capture audio : utilise le package record
- Lecture : utilise flutter_sound ou just_audio
- Sample rate : 44100 Hz, mono, PCM16
- correctionStrength = 1.0 pour l'effet T-Pain
```
