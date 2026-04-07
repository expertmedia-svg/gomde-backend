// autotune_widget.dart
// Widget Flutter pour l'autotune T-Pain en temps réel
// Dépendances requises dans pubspec.yaml :
//   record: ^5.0.0
//   flutter_sound: ^9.2.13
//   just_audio: ^0.9.38

import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'autotune_engine.dart';

// ─────────────────────────────────────────────────────────
//  FAUX STREAM AUDIO (pour test sans micro physique)
//  Remplace par flutter_sound / record en production
// ─────────────────────────────────────────────────────────
class FakeAudioStream {
  static Stream<Int16List> generate({int sampleRate = 44100, int bufferSize = 2048}) {
    final rng = List.generate(bufferSize, (i) {
      // Génère une sinusoïde à 220 Hz (La3) + harmoniques pour simuler une voix
      final t = i / sampleRate;
      final sample = 0.4 * (sin(2 * 3.14159 * 220 * t) +
          0.3 * sin(2 * 3.14159 * 440 * t) +
          0.1 * sin(2 * 3.14159 * 660 * t));
      return (sample * 32767).round().clamp(-32768, 32767);
    });
    return Stream.periodic(
      Duration(milliseconds: (bufferSize / sampleRate * 1000).round()),
      (_) => Int16List.fromList(rng),
    );
  }
}

// ─────────────────────────────────────────────────────────
//  AUTOTUNE CONTROLLER (ChangeNotifier)
// ─────────────────────────────────────────────────────────
class AutotuneController extends ChangeNotifier {
  late AutotuneEngine _engine;
  StreamSubscription? _sub;

  bool isActive = false;
  double correctionStrength = 1.0;  // 1.0 = T-Pain effect maximal
  double wetMix = 1.0;
  String currentNote = 'La3';
  double currentFreq = 220.0;
  String selectedScale = 'major';
  int rootNote = 0;  // Do

  static const scaleLabels = {
    'major':      'Majeure',
    'minor':      'Mineure',
    'pentatonic': 'Pentatonique',
    'blues':      'Blues',
    'chromatic':  'Chromatique',
  };

  static const noteNames = ['Do','Do#','Ré','Ré#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'];

  void _buildEngine() {
    _engine = AutotuneEngine(
      scale: Scale(rootNote: rootNote, scaleName: selectedScale),
      correctionStrength: correctionStrength,
      wetMix: wetMix,
    );
  }

  void toggle() {
    if (isActive) {
      _sub?.cancel();
      isActive = false;
    } else {
      _buildEngine();
      // ⚡ En production : remplace FakeAudioStream par flutter_sound recorder
      _sub = FakeAudioStream.generate().listen((pcm) {
        final processed = _engine.process(pcm);
        // ⚡ En production : envoie `processed` vers le speaker / flutter_sound player
        currentNote = _engine.currentNote;
        currentFreq = _engine.currentFrequency;
        notifyListeners();
      });
      isActive = true;
    }
    notifyListeners();
  }

  void setCorrectionStrength(double v) {
    correctionStrength = v;
    _engine.correctionStrength = v;
    notifyListeners();
  }

  void setWetMix(double v) {
    wetMix = v;
    _engine.wetMix = v;
    notifyListeners();
  }

  void setScale(String s) {
    selectedScale = s;
    _buildEngine();
    notifyListeners();
  }

  void setRoot(int r) {
    rootNote = r;
    _buildEngine();
    notifyListeners();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

// ─────────────────────────────────────────────────────────
//  WIDGET PRINCIPAL
// ─────────────────────────────────────────────────────────
class AutotuneWidget extends StatefulWidget {
  const AutotuneWidget({super.key});
  @override
  State<AutotuneWidget> createState() => _AutotuneWidgetState();
}

class _AutotuneWidgetState extends State<AutotuneWidget>
    with SingleTickerProviderStateMixin {
  final _ctrl = AutotuneController();
  late AnimationController _pulseCtrl;
  late Animation<double> _pulse;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
    _pulse = Tween(begin: 0.95, end: 1.05).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut));
    _ctrl.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _pulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isOn = _ctrl.isActive;
    final accentColor = isOn ? const Color(0xFF7C4DFF) : Colors.grey;

    return Scaffold(
      backgroundColor: const Color(0xFF0D0D0D),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // ── HEADER ──────────────────────────────────────
            Row(children: [
              const Icon(Icons.auto_fix_high, color: Color(0xFF7C4DFF), size: 28),
              const SizedBox(width: 10),
              Text('Autotune T-Pain',
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: Colors.white, fontWeight: FontWeight.bold)),
              const Spacer(),
              _chip(isOn ? 'ON' : 'OFF', accentColor),
            ]),
            const SizedBox(height: 24),

            // ── NOTE AFFICHÉE ────────────────────────────────
            Center(
              child: ScaleTransition(
                scale: isOn ? _pulse : const AlwaysStoppedAnimation(1.0),
                child: Container(
                  width: 160, height: 160,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: accentColor, width: 3),
                    color: accentColor.withOpacity(0.08),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_ctrl.currentNote,
                        style: const TextStyle(
                          fontSize: 40, fontWeight: FontWeight.bold,
                          color: Colors.white)),
                      Text('${_ctrl.currentFreq.toStringAsFixed(1)} Hz',
                        style: TextStyle(
                          fontSize: 14, color: Colors.white.withOpacity(0.5))),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 28),

            // ── BOUTON ACTIVER ───────────────────────────────
            SizedBox(
              height: 56,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: isOn ? Colors.red.shade800 : const Color(0xFF7C4DFF),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
                ),
                onPressed: _ctrl.toggle,
                icon: Icon(isOn ? Icons.stop_circle : Icons.mic),
                label: Text(isOn ? 'Arrêter l\'autotune' : 'Activer le micro',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
            const SizedBox(height: 28),

            // ── SECTION PARAMÈTRES ───────────────────────────
            _sectionTitle('Paramètres'),
            const SizedBox(height: 12),

            _paramSlider(
              label: 'Correction T-Pain',
              value: _ctrl.correctionStrength,
              icon: Icons.tune,
              color: const Color(0xFF7C4DFF),
              onChanged: _ctrl.setCorrectionStrength,
              hint: _ctrl.correctionStrength >= 0.95
                  ? '🎤 Effet T-Pain max'
                  : _ctrl.correctionStrength >= 0.5
                      ? 'Correction modérée'
                      : 'Correction légère',
            ),
            const SizedBox(height: 8),

            _paramSlider(
              label: 'Wet / Dry mix',
              value: _ctrl.wetMix,
              icon: Icons.water_drop,
              color: const Color(0xFF00BCD4),
              onChanged: _ctrl.setWetMix,
              hint: _ctrl.wetMix >= 0.95 ? '100% traité' : '${(_ctrl.wetMix * 100).round()}% traité',
            ),
            const SizedBox(height: 20),

            // ── GAMME ────────────────────────────────────────
            _sectionTitle('Gamme'),
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8,
              children: AutotuneController.scaleLabels.entries.map((e) {
                final selected = _ctrl.selectedScale == e.key;
                return ChoiceChip(
                  label: Text(e.value),
                  selected: selected,
                  selectedColor: const Color(0xFF7C4DFF),
                  backgroundColor: const Color(0xFF1E1E1E),
                  labelStyle: TextStyle(
                    color: selected ? Colors.white : Colors.white54,
                    fontWeight: selected ? FontWeight.bold : FontWeight.normal),
                  onSelected: (_) => _ctrl.setScale(e.key),
                );
              }).toList(),
            ),
            const SizedBox(height: 20),

            // ── NOTE RACINE ──────────────────────────────────
            _sectionTitle('Note racine'),
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6,
              children: List.generate(12, (i) {
                final selected = _ctrl.rootNote == i;
                return GestureDetector(
                  onTap: () => _ctrl.setRoot(i),
                  child: Container(
                    width: 48, height: 48,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: selected
                          ? const Color(0xFF7C4DFF)
                          : const Color(0xFF1E1E1E),
                      border: Border.all(
                        color: selected
                            ? const Color(0xFF7C4DFF)
                            : Colors.white12),
                    ),
                    child: Center(
                      child: Text(AutotuneController.noteNames[i],
                        style: TextStyle(
                          fontSize: 11, fontWeight: FontWeight.bold,
                          color: selected ? Colors.white : Colors.white54))),
                  ),
                );
              }),
            ),

            const SizedBox(height: 32),
            // ── NOTE TECHNIQUE ────────────────────────────────
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A1A),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white10)),
              child: const Text(
                '⚡ Pour un vrai traitement audio temps réel, connecte ce widget '
                'au package flutter_sound (recorder → process() → player) ou record + audioplayers. '
                'Le moteur AutotuneEngine.process() accepte n\'importe quel buffer Int16List PCM.',
                style: TextStyle(fontSize: 12, color: Colors.white38, height: 1.5),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(String t) =>
    Text(t, style: const TextStyle(
      color: Colors.white70, fontSize: 13,
      fontWeight: FontWeight.bold, letterSpacing: 1.1));

  Widget _chip(String label, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    decoration: BoxDecoration(
      color: color.withOpacity(0.15),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: color.withOpacity(0.5))),
    child: Text(label,
      style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)));

  Widget _paramSlider({
    required String label,
    required double value,
    required IconData icon,
    required Color color,
    required ValueChanged<double> onChanged,
    required String hint,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Text(label, style: const TextStyle(
            color: Colors.white, fontWeight: FontWeight.w500)),
          const Spacer(),
          Text(hint, style: TextStyle(color: color, fontSize: 12)),
        ]),
        Slider(
          value: value, min: 0.0, max: 1.0, divisions: 20,
          activeColor: color,
          inactiveColor: Colors.white12,
          onChanged: onChanged,
        ),
      ]),
    );
  }
}

// ─────────────────────────────────────────────────────────
//  MAIN (pour tester en isolation)
// ─────────────────────────────────────────────────────────
void main() {
  runApp(const MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Autotune T-Pain',
    home: AutotuneWidget(),
  ));
}
