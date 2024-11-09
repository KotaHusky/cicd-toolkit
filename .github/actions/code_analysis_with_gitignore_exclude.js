const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const minimatch = require('minimatch');

const approvedTypes = process.env.APPROVED_TYPES.split(',');
const maxSizeBytes = parseInt(process.env.MAX_SIZE_MB) * 1024 * 1024;
const maxCallsPerHour = parseInt(process.env.MAX_CALLS_PER_HOUR) || 3;
const directory = process.env.DIRECTORY;
const excludePatterns = process.env.EXCLUDE ? process.env.EXCLUDE.split(',') : [];
const openaiApiKey = process.env.OPENAI_API_KEY;
const callCountFile = path.join('.github/actions/hourly_call_count.json');
const oneHour = 60 * 60 * 1000;

// Function to generate a unique hash for each API call
function generateUniqueHash() {
  return crypto.createHash('md5').update(Date.now().toString() + Math.random().toString()).digest('hex').slice(0, 12);
}

// Function to retrieve current call count, filtering out entries older than one hour
function getHourlyCallCount() {
  if (!fs.existsSync(callCountFile)) {
    return { count: 0, calls: [] };
  }

  const data = JSON.parse(fs.readFileSync(callCountFile, 'utf8'));
  const currentTime = Date.now();

  // Filter to keep only calls within the last hour
  const recentCalls = data.calls.filter(call => currentTime - call.timestamp < oneHour);

  return {
    count: recentCalls.length,
    calls: recentCalls
  };
}

// Function to add a new API call to the call count file and apply the sliding window
function updateHourlyCallCount() {
  const currentData = getHourlyCallCount();
  const newCall = {
    hash: generateUniqueHash(),
    timestamp: Date.now()
  };

  // Add new call and reapply the sliding window to keep only the recent calls
  currentData.calls.push(newCall);
  const recentCalls = currentData.calls.filter(call => Date.now() - call.timestamp < oneHour);

  // Update count based on the filtered recent calls
  currentData.count = recentCalls.length;
  currentData.calls = recentCalls;

  fs.writeFileSync(callCountFile, JSON.stringify(currentData, null, 2));
}

// Function to check if a file path matches any of the exclude patterns
function isExcluded(filePath) {
  return excludePatterns.some(pattern => minimatch(filePath, pattern.trim()));
}

// Load and filter files by approved type and exclusion patterns
function loadApprovedFiles() {
  let combinedText = '';
  let totalSize = 0;

  const files = fs.readdirSync(directory).filter(file => {
    const filePath = path.join(directory, file);
    return approvedTypes.includes(path.extname(file)) && !isExcluded(filePath);
  });

  for (const file of files) {
    const filePath = path.join(directory, file);
    const fileSize = fs.statSync(filePath).size;

    if (totalSize + fileSize > maxSizeBytes) {
      console.log(`Skipping file ${filePath} (size exceeds limit)`);
      continue;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    combinedText += `\n### File: ${filePath} ###\n\n${fileContent}\n`;
    totalSize += fileSize;

    if (totalSize >= maxSizeBytes) {
      console.log(`Total size limit reached at ${totalSize} bytes.`);
      break;
    }
  }

  console.log(`Total content size: ${totalSize} bytes`);
  return { combinedText, totalSize };
}

// Make ChatGPT API call
async function getAIFindings(inputText) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a code review assistant.' },
        { role: 'user', content: `Analyze the following code:\n\n${inputText}` }
      ]
    },
    { headers: { Authorization: `Bearer ${openaiApiKey}` } }
  );

  return response.data.choices[0].message.content;
}

// Main function to control workflow
async function main() {
  const { count } = getHourlyCallCount();

  if (count >= maxCallsPerHour) {
    console.log(`Info: Maximum ChatGPT call limit of ${maxCallsPerHour} per hour reached. Skipping analysis.`);
    return;
  }

  const { combinedText, totalSize } = loadApprovedFiles();

  if (totalSize > maxSizeBytes) {
    console.log(`Info: Total file size (${totalSize} bytes) exceeds limit of ${maxSizeBytes} bytes. Skipping analysis.`);
  } else if (!combinedText.trim()) {
    console.log('Info: No approved file types found. Skipping analysis.');
  } else {
    try {
      const findings = await getAIFindings(combinedText);
      console.log('AI Findings:', findings);
      updateHourlyCallCount();
    } catch (error) {
      console.error('Error during ChatGPT analysis:', error);
    }
  }
}

main().catch(console.error);
