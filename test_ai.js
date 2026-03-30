const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function testAi() {
  const aiService = require('./src/services/ai.service');
  
  // Create a dummy image
  const testImagePath = path.join(__dirname, 'test_plant.png');
  await sharp({
    create: {
      width: 224,
      height: 224,
      channels: 3,
      background: { r: 34, g: 139, b: 34 } // Green
    }
  }).png().toFile(testImagePath);

  console.log('--- Testing Local AI Identification ---');
  try {
    const result = await aiService.identify(testImagePath);
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('\n✅ AI Identification Working!');
  } catch (err) {
    console.error('❌ AI Identification Failed:', err);
  } finally {
    if (fs.existsSync(testImagePath)) fs.unlinkSync(testImagePath);
    process.exit(0);
  }
}

testAi();
