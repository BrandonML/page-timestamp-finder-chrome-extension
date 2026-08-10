const fs = require('fs');
const path = require('path');

// Extract the processStructuredData function from content.js
const contentJsPath = path.join(__dirname, '..', 'content.js');
let contentJs = fs.readFileSync(contentJsPath, 'utf8');

// To evaluate the isolated function, we wrap it in a mock environment
const functionCode = `
    ${contentJs}
    return processStructuredData;
`;
const processStructuredData = new Function('module', 'window', 'document', 'chrome', functionCode)(
    { exports: {} }, {}, {}, { runtime: { sendMessage: () => {} }, i18n: { getMessage: () => '' } }
);

function generatePayload(depth, breadth) {
    if (depth === 0) {
        return {
            '@type': 'Article',
            'datePublished': '2023-01-01T12:00:00Z',
            'dateModified': '2023-01-02T12:00:00Z',
        };
    }

    const payload = {
        '@type': 'ItemList',
        'itemListElement': []
    };

    for (let i = 0; i < breadth; i++) {
        // Types that are NOT in the ignored list so the recursion continues fully
        const types = ['Article', 'BlogPosting', 'NewsArticle', 'WebPage'];
        let type = types[i % types.length];

        payload.itemListElement.push({
            '@type': type,
            'description': 'Item ' + i,
            'nested': generatePayload(depth - 1, breadth)
        });
    }
    return payload;
}

const largePayload = generatePayload(7, 5); // depth 7, breadth 5 -> ~78,125 elements
console.log('Generated larger payload without early exit branches.');

// Benchmark
const iterations = 100;
let totalDuration = 0;

console.log(`Running benchmark with ${iterations} iterations...`);

const start = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
    const results = { modified: null, published: null, created: null, modifiedType: null, publishedType: null, createdType: null };
    processStructuredData(largePayload, results);
}
const end = process.hrtime.bigint();

totalDuration = Number(end - start) / 1e6; // Convert to milliseconds

console.log(`\nResults:`);
console.log(`Total time for ${iterations} iterations: ${totalDuration.toFixed(2)} ms`);
console.log(`Average time per iteration: ${(totalDuration / iterations).toFixed(4)} ms`);
