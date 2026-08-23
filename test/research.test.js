/**
 * Exercises pages/research.js against a saved copy of the LeekDuck research
 * page markup, so the scrape can be checked without hitting the live site.
 *
 * Run with: npm run test:research
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'research-page.html');

// pages/research.js reads the live site through JSDOM.fromURL. Point it at the
// fixture before the module is loaded so both share the same patched class.
const jsd = require(path.join(repoRoot, 'node_modules', 'jsdom'));
const fromFile = jsd.JSDOM.fromFile.bind(jsd.JSDOM);
jsd.JSDOM.fromURL = () => fromFile(fixture);

const research = require(path.join(repoRoot, 'pages', 'research.js'));

function testSplitRewardAmount()
{
    var cases = [
        ["1000 Stardust",         { name: "Stardust",              amount: 1000 }],
        ["1,000 Stardust",        { name: "Stardust",              amount: 1000 }],
        ["Stardust × 500",   { name: "Stardust",              amount: 500 }],
        ["Ultra Ball ×20",   { name: "Ultra Ball",            amount: 20 }],
        ["Max Revive x2",         { name: "Max Revive",            amount: 2 }],
        ["×3 Rare Candy",    { name: "Rare Candy",            amount: 3 }],
        ["Poffin",                { name: "Poffin",                amount: null }],
        ["Fast TM",               { name: "Fast TM",               amount: null }],
        ["Venusaur Mega Energy",  { name: "Venusaur Mega Energy",  amount: null }]
    ];

    cases.forEach(c => {
        assert.deepStrictEqual(research.splitRewardAmount(c[0]), c[1], `splitRewardAmount(${JSON.stringify(c[0])})`);
    });

    console.log(`  ok  splitRewardAmount (${cases.length} labels)`);
}

function testScrape()
{
    // get() writes to files/ relative to the working directory.
    var workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrapedduck-'));
    var cwd = process.cwd();
    process.chdir(workDir);
    fs.mkdirSync('files');

    research.get();

    return new Promise(resolve => setTimeout(resolve, 1500)).then(() => {
        var out = JSON.parse(fs.readFileSync(path.join(workDir, 'files', 'research.json'), 'utf8'));
        process.chdir(cwd);
        fs.rmSync(workDir, { recursive: true, force: true });

        assert.strictEqual(out.length, 3, 'task count');

        // Pokemon rewards and item rewards live side by side, and a second
        // task-item with the same text and type merges into the first.
        var mixed = out[0];
        assert.strictEqual(mixed.text, '<span>Catch 7 Pokémon</span>');
        assert.strictEqual(mixed.type, 'catch');
        assert.deepStrictEqual(mixed.rewards, [{
            name: 'Magikarp',
            image: 'https://cdn.leekduck.com/assets/img/pokemon_icons_crop/pm129.icon.png',
            canBeShiny: true,
            combatPower: { min: 99, max: 117 }
        }], 'encounter rewards are untouched');
        assert.deepStrictEqual(mixed.items, [
            { name: 'Stardust',   image: 'https://cdn.leekduck.com/assets/img/items/stardust.png',   amount: 1000 },
            { name: 'Ultra Ball', image: 'https://cdn.leekduck.com/assets/img/items/ultra_ball.png', amount: 20 }
        ], 'item rewards merge across duplicate task entries');

        // A task whose only rewards are items still gets emitted, with an empty
        // rewards array. A reward node carrying no label is skipped.
        var itemOnly = out[1];
        assert.deepStrictEqual(itemOnly.rewards, [], 'item-only task keeps an empty rewards array');
        assert.deepStrictEqual(itemOnly.items, [
            { name: 'Poffin',     image: 'https://cdn.leekduck.com/assets/img/items/poffin.png',     amount: null },
            { name: 'Rare Candy', image: 'https://cdn.leekduck.com/assets/img/items/rare_candy.png', amount: 3 }
        ], 'unlabelled reward nodes are skipped');

        // Tasks with no item rewards omit the key entirely.
        assert.strictEqual('items' in out[2], false, 'items is omitted when empty');

        console.log('  ok  scrape output shape');
    });
}

testSplitRewardAmount();
testScrape().then(
    () => console.log('\nresearch: all checks passed'),
    err => { console.error(err); process.exit(1); }
);
