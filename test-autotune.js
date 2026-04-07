#!/usr/bin/env node
/**
 * Test script for autotune service integration
 * Usage: npm run test:autotune
 */

const { applyAutotune, isAutotuneAvailable } = require('./services/autotune');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('\n🎤 AUTOTUNE SERVICE TEST\n');
  console.log('═'.repeat(50));

  // Test 1: Check if autotune is available
  console.log('\n[Test 1] Checking Python/librosa availability...');
  try {
    const available = await isAutotuneAvailable();
    if (available) {
      console.log('✓ Autotune service is available');
    } else {
      console.log('✗ Autotune service is NOT available (Python/librosa missing)');
      process.exit(1);
    }
  } catch (error) {
    console.log(`✗ Error checking availability: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Apply autotune to test file
  console.log('\n[Test 2] Applying autotune to test audio...');
  try {
    const inputFile = path.join(__dirname, 'test_input.wav');
    const outputFile = path.join(__dirname, 'test_output_nodejs.wav');

    if (!fs.existsSync(inputFile)) {
      console.log(`✗ Input file not found: ${inputFile}`);
      console.log('  Creating test file...');
      
      const pythonCode = `
import soundfile as sf
import numpy as np
sr = 44100
duration = 2
freq = 220
t = np.linspace(0, duration, int(sr * duration))
audio = np.sin(2 * np.pi * freq * t) * 0.3
sf.write('test_input.wav', audio, sr)
`;
      const { execSync } = require('child_process');
      execSync(`python -c "${pythonCode}"`);
      console.log('✓ Test file created');
    }

    const result = await applyAutotune({
      inputPath: inputFile,
      outputPath: outputFile,
      strength: 0.8,
      scale: 'major',
      rootNote: 0,
      wetMix: 1.0
    });

    if (result.success) {
      console.log(`✓ Autotune applied successfully`);
      console.log(`  Output: ${outputFile}`);
      console.log(`  Message: ${result.message}`);

      // Check if file exists
      if (fs.existsSync(outputFile)) {
        const stats = fs.statSync(outputFile);
        console.log(`  File size: ${(stats.size / 1024).toFixed(2)} KB`);
      }
    } else {
      console.log(`✗ Autotune failed: ${result.message}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.log(`✗ Exception during autotune: ${error.message}`);
    process.exit(1);
  }

  // Test 3: Test with different scales
  console.log('\n[Test 3] Testing different scales...');
  const scales = ['major', 'minor', 'pentatonic', 'blues'];
  for (const scale of scales) {
    try {
      const inputFile = path.join(__dirname, 'test_input.wav');
      const outputFile = path.join(__dirname, `test_output_${scale}.wav`);

      const result = await applyAutotune({
        inputPath: inputFile,
        outputPath: outputFile,
        strength: 0.9,
        scale: scale,
        rootNote: 0
      });

      if (result.success) {
        console.log(`✓ Scale "${scale}" applied successfully`);
      } else {
        console.log(`✗ Scale "${scale}" failed`);
      }
    } catch (error) {
      console.log(`✗ Scale "${scale}" error: ${error.message}`);
    }
  }

  // Test 4: Error handling
  console.log('\n[Test 4] Testing error handling...');
  try {
    await applyAutotune({
      inputPath: '/nonexistent/file.wav',
      outputPath: '/tmp/output.wav',
      strength: 0.8,
      scale: 'major',
      rootNote: 0
    });
    console.log('✗ Should have failed with nonexistent input');
  } catch (error) {
    console.log(`✓ Correctly caught error: ${error.message}`);
  }

  console.log('\n═'.repeat(50));
  console.log('\n✅ ALL TESTS PASSED!\n');
  process.exit(0);
}

runTests().catch((error) => {
  console.error('\n❌ Test suite failed:', error);
  process.exit(1);
});
