const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');
const axios = require('axios');
jest.mock('axios');  // Mock axios to prevent actual API calls

const { loadApprovedFiles, isExcluded, getHourlyCallCount, updateHourlyCallCount } = require('../.github/actions/code_analysis_with_gitignore_exclude');

const approvedTypes = ['.js', '.py'];
const excludePatterns = ['test/**', 'scripts/*.js', '!scripts/include_this.js'];
const maxSizeBytes = 1024 * 1024;

describe('AI Feedback Code Analysis', () => {
  beforeEach(() => {
    if (fs.existsSync('.github/actions/hourly_call_count.json')) {
      fs.unlinkSync('.github/actions/hourly_call_count.json');
    }
  });

  test('should filter approved files and respect exclude patterns', () => {
    const files = [
      'src/file1.js', 'src/file2.py', 'test/file3.js', 'scripts/file4.js', 'scripts/include_this.js'
    ];

    const includedFiles = files.filter(file => 
      approvedTypes.includes(path.extname(file)) && !isExcluded(file)
    );

    expect(includedFiles).toEqual([
      'src/file1.js', 'src/file2.py', 'scripts/include_this.js'
    ]);
  });

  test('should respect max size limit', () => {
    const combinedText = loadApprovedFiles('src');
    expect(combinedText.totalSize).toBeLessThanOrEqual(maxSizeBytes);
  });

  test('should limit API calls per hour', () => {
    let { count } = getHourlyCallCount();
    expect(count).toBe(0);

    updateHourlyCallCount(1);
    ({ count } = getHourlyCallCount());
    expect(count).toBe(1);
  });

  test('should simulate ChatGPT API call with mock data', async () => {
    const mockResponse = { data: { choices: [{ message: { content: 'Mock AI Feedback' } }] } };
    axios.post.mockResolvedValue(mockResponse);

    const response = await getAIFindings("Mock input text");
    expect(response).toBe('Mock AI Feedback');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
