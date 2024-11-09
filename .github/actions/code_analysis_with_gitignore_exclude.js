const fs = require('fs');
const path = require('path');
const axios = require('axios');
const minimatch = require('minimatch');

const approvedTypes = process.env.APPROVED_TYPES.split(',');
const maxSizeBytes = parseInt(process.env.MAX_SIZE_MB) * 1024 * 1024;
const maxCallsPerHour = parseInt(process.env.MAX_CALLS_PER_HOUR);
const directory = process.env.DIRECTORY;
const excludePatterns = process.env.EXCLUDE ? process.env.EXCLUDE.split(',') : [];
const openaiApiKey = process.env.OPENAI_API_KEY;
const callCountFile = '.github/actions/hourly_call_count.json';

// Check if a file path matches any of the exclude patterns
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

// Enforce hourly rate limiting based on timestamped call count
function getHourlyCallCount() {
  if (!fs.existsSync(callCountFile)) {
    return { count: 0, timestamp: Date.now() };
  }
  const data = JSON.parse(fs.readFileSync(callCountFile, 'utf8'));

  const currentTime = Date.now();
  const oneHour = 60 * 60 * 1000;

  if (currentTime - data.timestamp >= oneHour) {
    return { count: 0, timestamp: currentTime };
  }
  return data;
}

function updateHourlyCallCount(newCount) {
  const data = { count: newCount, timestamp: Date.now() };
  fs.writeFileSync(callCountFile, JSON.stringify(data));
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
  const { count, timestamp } = getHourlyCallCount();

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
      updateHourlyCallCount(count + 1);
    } catch (error) {
      console.error('Error during ChatGPT analysis:', error);
    }
  }
}

main().catch(console.error);
