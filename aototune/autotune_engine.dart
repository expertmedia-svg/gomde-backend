// autotune_engine.dart
// Moteur autotune T-Pain effect – 100% Dart, pas de dépendances natives
// Intégre dans Flutter via flutter_sound ou record package

import 'dart:math';
import 'dart:typed_data';

/// ─────────────────────────────────────────────
///  GAMMES MUSICALES (notes en demi-tons)
/// ─────────────────────────────────────────────
class Scale {
  static const Map<String, List<int>> scales = {
    'major':       [0, 2, 4, 5, 7, 9, 11],  // Do majeur
    'minor':       [0, 2, 3, 5, 7, 8, 10],  // La mineur
    'chromatic':   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'pentatonic':  [0, 2, 4, 7, 9],
    'blues':       [0, 3, 5, 6, 7, 10],
  };

  /// Note racine : 0=Do, 1=Do#, 2=Ré … 11=Si
  final int rootNote;
  final String scaleName;
  late List<int> _semitones;

  Scale({this.rootNote = 0, this.scaleName = 'major'}) {
    final base = scales[scaleName] ?? scales['major']!;
    _semitones = base.map((s) => (s + rootNote) % 12).toList()..sort();
  }

  /// Retourne la note la plus proche dans la gamme (en demi-tons MIDI)
  double snapToScale(double midiNote) {
    final noteInOctave = midiNote % 12;
    double bestNote = _semitones[0].toDouble();
    double minDist = double.infinity;

    for (int s in _semitones) {
      // Compare sur l'octave courante ET voisines
      for (int octShift in [-12, 0, 12]) {
        final candidate = s.toDouble() + octShift;
        final dist = (noteInOctave - candidate).abs();
        if (dist < minDist) {
          minDist = dist;
          bestNote = candidate;
        }
      }
    }
    // Restitue l'octave correcte
    return midiNote - (noteInOctave - bestNote);
  }
}

/// ─────────────────────────────────────────────
///  DÉTECTION DE FRÉQUENCE (algo YIN simplifié)
/// ─────────────────────────────────────────────
class PitchDetector {
  final int sampleRate;
  final int bufferSize;
  static const double yinThreshold = 0.10;

  PitchDetector({this.sampleRate = 44100, this.bufferSize = 2048});

  /// Retourne la fréquence fondamentale en Hz, ou -1 si non détectée
  double detect(Float64List buffer) {
    final yinBuffer = Float64List(bufferSize ~/ 2);

    // Étape 1 : différence quadratique
    yinBuffer[0] = 1.0;
    double runningSum = 0.0;

    for (int tau = 1; tau < yinBuffer.length; tau++) {
      double sum = 0.0;
      for (int i = 0; i < yinBuffer.length; i++) {
        final delta = buffer[i] - buffer[i + tau];
        sum += delta * delta;
      }
      yinBuffer[tau] = sum;
      runningSum += sum;
      // Étape 2 : normalisation cumulative
      yinBuffer[tau] *= tau / runningSum;
    }

    // Étape 3 : cherche le 1er minimum sous le seuil
    int tau = 2;
    while (tau < yinBuffer.length - 1) {
      if (yinBuffer[tau] < yinThreshold &&
          yinBuffer[tau] < yinBuffer[tau + 1]) {
        // Étape 4 : interpolation parabolique
        final x0 = tau - 1;
        final x2 = tau + 1;
        final s0 = yinBuffer[x0], s1 = yinBuffer[tau], s2 = yinBuffer[x2];
        final betterTau = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
        return sampleRate / betterTau;
      }
      tau++;
    }
    return -1.0; // Pas de pitch détecté
  }
}

/// ─────────────────────────────────────────────
///  CONVERSION FRÉQUENCE ↔ MIDI
/// ─────────────────────────────────────────────
class MidiUtil {
  static const double a4Freq = 440.0;
  static const int a4Midi = 69;

  static double freqToMidi(double freq) =>
      a4Midi + 12 * log(freq / a4Freq) / log(2);

  static double midiToFreq(double midi) =>
      a4Freq * pow(2, (midi - a4Midi) / 12).toDouble();
}

/// ─────────────────────────────────────────────
///  PITCH SHIFTING (PSOLA simplifié par FFT)
/// ─────────────────────────────────────────────
class PitchShifter {
  /// Shift un buffer PCM Float64 par un facteur (1.0 = pas de changement)
  /// Ex : factor = 2.0 → une octave au dessus
  /// Implémentation : resampling + overlap-add
  Float64List shift(Float64List input, double factor) {
    if ((factor - 1.0).abs() < 0.001) return input;

    final outputLength = input.length;
    final output = Float64List(outputLength);
    final hopSizeOutput = 64;
    final hopSizeInput = (hopSizeOutput * factor).round().clamp(1, input.length);
    final windowSize = 256;
    final window = _hanningWindow(windowSize);

    int outputPos = 0;
    int inputPos = 0;

    while (outputPos + windowSize < outputLength &&
        inputPos + windowSize < input.length) {
      // Copie le frame source
      for (int i = 0; i < windowSize; i++) {
        final srcIdx = (inputPos + i).clamp(0, input.length - 1);
        output[outputPos + i] += input[srcIdx] * window[i];
      }
      outputPos += hopSizeOutput;
      inputPos  += hopSizeInput;
    }
    return output;
  }

  List<double> _hanningWindow(int size) =>
      List.generate(size, (i) => 0.5 * (1 - cos(2 * pi * i / (size - 1))));
}

/// ─────────────────────────────────────────────
///  AUTOTUNE ENGINE — point d'entrée principal
/// ─────────────────────────────────────────────
class AutotuneEngine {
  final int sampleRate;
  final Scale scale;

  /// Vitesse de correction : 0.0 = désactivé, 1.0 = effet T-Pain maximal
  double correctionStrength;

  /// Mélange signal sec/traité : 0.0 = 100% sec, 1.0 = 100% traité
  double wetMix;

  final _detector = PitchDetector();
  final _shifter  = PitchShifter();

  // État interne
  double _currentMidi = 60.0;       // Do4 par défaut
  double _smoothedMidi = 60.0;
  static const double _smoothing = 0.85;  // Momentum pour éviter les sauts

  AutotuneEngine({
    this.sampleRate = 44100,
    Scale? scale,
    this.correctionStrength = 1.0,  // T-Pain = 1.0 (correction dure)
    this.wetMix = 1.0,
  }) : scale = scale ?? Scale();

  /// Traite un buffer PCM 16-bit (Int16List) et retourne l'audio corrigé
  Int16List process(Int16List pcm16) {
    // 1. Convertir Int16 → Float64 [-1.0, 1.0]
    final floatBuf = Float64List(pcm16.length);
    for (int i = 0; i < pcm16.length; i++) {
      floatBuf[i] = pcm16[i] / 32768.0;
    }

    // 2. Détecter la fréquence
    final detectedHz = _detector.detect(floatBuf);

    Float64List output;

    if (detectedHz > 50 && detectedHz < 2000) {
      // 3. Convertir en MIDI et lisser
      final detectedMidi = MidiUtil.freqToMidi(detectedHz);
      _smoothedMidi = _smoothing * _smoothedMidi + (1 - _smoothing) * detectedMidi;

      // 4. Snapper à la gamme
      final targetMidi = scale.snapToScale(_smoothedMidi);

      // 5. Appliquer la force de correction (T-Pain = snap dur)
      final correctedMidi = _smoothedMidi + (targetMidi - _smoothedMidi) * correctionStrength;
      _currentMidi = correctedMidi;

      // 6. Calculer le facteur de shift
      final shiftFactor = MidiUtil.midiToFreq(correctedMidi) / detectedHz;

      // 7. Pitcher le signal
      final shifted = _shifter.shift(floatBuf, shiftFactor);

      // 8. Mélanger wet/dry
      output = Float64List(floatBuf.length);
      for (int i = 0; i < output.length; i++) {
        output[i] = floatBuf[i] * (1 - wetMix) + shifted[i] * wetMix;
      }
    } else {
      output = floatBuf; // Pas de pitch détecté → signal sec
    }

    // 9. Reconvertir en Int16
    final result = Int16List(output.length);
    for (int i = 0; i < output.length; i++) {
      result[i] = (output[i] * 32767).round().clamp(-32768, 32767);
    }
    return result;
  }

  /// Retourne la note courante détectée (ex: "Do#4")
  String get currentNote {
    const noteNames = ['Do','Do#','Ré','Ré#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'];
    final midiInt = _currentMidi.round();
    final noteName = noteNames[midiInt % 12];
    final octave = (midiInt ~/ 12) - 1;
    return '$noteName$octave';
  }

  double get currentFrequency => MidiUtil.midiToFreq(_currentMidi);
}
