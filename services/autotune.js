// autotune.service.js
// Node.js wrapper for Python autotune service

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const AUTOTUNE_SCRIPT = path.join(__dirname, 'autotune.service.py');

/**
 * Apply autotune effect to audio file using Python librosa
 * @param {Object} options
 * @param {string} options.inputPath - Input audio file path
 * @param {string} options.outputPath - Output audio file path
 * @param {number} options.strength - Correction strength (0-1)
 * @param {string} options.scale - Scale name ('major', 'minor', 'pentatonic', 'blues', 'chromatic')
 * @param {number} options.rootNote - Root note (0-11)
 * @param {number} options.wetMix - Wet/dry mix (0-1)
 * @returns {Promise<Object>} Result with success flag and message
 */
exports.applyAutotune = async (options) => {
  return new Promise((resolve, reject) => {
    const {
      inputPath,
      outputPath,
      strength = 1.0,
      scale = 'major',
      rootNote = 0,
      wetMix = 1.0
    } = options;

    // Validate inputs
    if (!inputPath || !fs.existsSync(inputPath)) {
      return reject(new Error('Input audio file not found'));
    }

    // Python command: python autotune.service.py <input> <output> <strength> <scale> <root>
    const pythonArgs = [
      AUTOTUNE_SCRIPT,
      inputPath,
      outputPath,
      String(strength),
      scale,
      String(rootNote),
      String(wetMix)
    ];

    const pythonProcess = spawn('python', pythonArgs, {
      stdio: 'pipe',
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Failed to parse Python output: ${parseError.message}`));
        }
      } else {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
      }
    });
  });
};

/**
 * Check if Python and required libraries are available
 * @returns {Promise<boolean>} True if autotune is available
 */
exports.isAutotuneAvailable = async () => {
  return new Promise((resolve) => {
    const checkProcess = spawn('python', ['-c', 'import librosa; import soundfile'], {
      stdio: 'pipe',
      windowsHide: true
    });

    checkProcess.on('close', (code) => {
      resolve(code === 0);
    });

    checkProcess.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      checkProcess.kill();
      resolve(false);
    }, 5000);
  });
};
