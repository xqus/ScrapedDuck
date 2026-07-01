const fs = require('fs');
const jsd = require('jsdom');
const { JSDOM } = jsd;
const https = require('https');

const EVENTS_FEED_URL = "https://leekduck.com/feeds/events.json";

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let body = "";
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

// Raid rotations reset at a fixed local time in each region (Niantic resets
// happen at e.g. 6:00 AM in every timezone individually, not at one shared
// UTC instant), so the events feed gives start/end without a timezone
// suffix. Treat that value as a wall-clock reading and widen it by the full
// spread of real-world UTC offsets (-12 to +14) to get the window during
// which the event is current somewhere on Earth.
function parseAsUtc(str) {
    if (!str) return null;
    return new Date(str.endsWith('Z') ? str : str + 'Z');
}

function isOngoingSomewhereInWorld(startStr, endStr, now) {
    const start = parseAsUtc(startStr);
    const end = parseAsUtc(endStr);
    if (!start || !end || isNaN(start) || isNaN(end)) return false;
    const HOUR = 60 * 60 * 1000;
    return now >= start.getTime() - 14 * HOUR && now <= end.getTime() + 12 * HOUR;
}

function tierFromEventId(eventID) {
    if (/-mega-raids-/.test(eventID)) return 'Mega Raids';
    const starMatch = eventID.match(/(\d)-star-raid-battles/);
    if (starMatch) return `${starMatch[1]}-Star Raids`;
    return null;
}

// Individual event pages list their headline bosses in the same simple
// `.pkmn-list-item` format used by pages/detailed/raidbattles.js, rather
// than the rich stat cards on /raid-bosses/ - so name/image/shiny is all
// that's available here.
function fetchEventRaidBosses(eventID) {
    return JSDOM.fromURL(`https://leekduck.com/events/${eventID}/`, {})
        .then((dom) => {
            const pageContent = dom.window.document.querySelector('.page-content');
            const result = [];
            let lastHeader = "";

            if (pageContent) {
                pageContent.childNodes.forEach(n => {
                    if (n.className && n.className.includes && n.className.includes("event-section-header")) {
                        lastHeader = n.id;
                    }

                    if (lastHeader === "raids" && n.className === "pkmn-list-flex") {
                        n.querySelectorAll(':scope > .pkmn-list-item').forEach(item => {
                            const name = item.querySelector(':scope > .pkmn-name')?.textContent.trim();
                            if (!name) return;
                            result.push({
                                name,
                                image: item.querySelector(':scope > .pkmn-list-img > img')?.src || "",
                                canBeShiny: item.querySelector(':scope > .shiny-icon') != null
                            });
                        });
                    }
                });
            }

            return result;
        })
        .catch(() => []);
}

// Shadow raid bosses are named "Shadow X" on /raid-bosses/, but their
// underlying event page (which only ever covers the headline 5-star boss,
// not the full multi-tier shadow roster) lists them without that prefix.
function normalizeBossKey(name) {
    return name.replace(/^Shadow\s+/i, '').trim().toLowerCase();
}

// The /raid-bosses/ page only ever renders the raid rotation for whichever
// region/timezone the request is treated as coming from. Cross-reference
// the public events feed for every regular/mega/shadow raid-battle event
// that is currently ongoing somewhere else in the world:
//  - use each event's start/end to attach a "when is this actually live"
//    window to every boss, including ones already picked up from the page
//  - merge in bosses from non-shadow events that the page itself missed
//    (shadow events are only used for timing here, since a single shadow
//    event page never lists the full roster, just its headline boss)
function addBossesOngoingElsewhere(bosses) {
    return fetchJson(EVENTS_FEED_URL).then(feed => {
        const now = Date.now();

        const ongoingRaidEvents = (feed || []).filter(e =>
            e && e.eventID &&
            (/-raid-battles-/.test(e.eventID) || /-mega-raids-/.test(e.eventID) || /-shadow-raids-/.test(e.eventID)) &&
            isOngoingSomewhereInWorld(e.start, e.end, now)
        );

        return Promise.all(ongoingRaidEvents.map(e =>
            fetchEventRaidBosses(e.eventID).then(eventBosses => ({ event: e, eventBosses }))
        )).then(results => {
            const timingByBossKey = new Map();
            results.forEach(({ event, eventBosses }) => {
                eventBosses.forEach(b => timingByBossKey.set(normalizeBossKey(b.name), { start: event.start, end: event.end }));
            });

            const existingNames = new Set(bosses.map(b => b.name.toLowerCase()));
            results.forEach(({ event, eventBosses }) => {
                if (/-shadow-raids-/.test(event.eventID)) return;
                const tier = tierFromEventId(event.eventID) || '5-Star Raids';
                eventBosses.forEach(b => {
                    const key = b.name.toLowerCase();
                    if (existingNames.has(key)) return;
                    existingNames.add(key);
                    bosses.push({
                        name: b.name,
                        tier,
                        canBeShiny: b.canBeShiny,
                        types: [],
                        combatPower: {
                            normal: { min: -1, max: -1 },
                            boosted: { min: -1, max: -1 }
                        },
                        boostedWeather: [],
                        image: b.image,
                        start: event.start,
                        end: event.end
                    });
                });
            });

            bosses.forEach(b => {
                if (b.start !== undefined) return;
                const timing = timingByBossKey.get(normalizeBossKey(b.name));
                b.start = timing?.start || null;
                b.end = timing?.end || null;
            });

            return bosses;
        });
    }).catch(_err => {
        console.log(_err);
        bosses.forEach(b => {
            if (b.start === undefined) {
                b.start = null;
                b.end = null;
            }
        });
        return bosses;
    });
}

function writeBosses(bosses) {
    fs.writeFile('files/raids.json', JSON.stringify(bosses, null, 4), err => {
        if (err) {
            console.error(err);
            return;
        }
    });
    fs.writeFile('files/raids.min.json', JSON.stringify(bosses), err => {
        if (err) {
            console.error(err);
            return;
        }
    });
}

function get() {
    return new Promise(resolve => {
        JSDOM.fromURL("https://leekduck.com/raid-bosses/", {
        })
            .then((dom) => {

                let bosses = [];
                const grids = dom.window.document.querySelectorAll('div.grid');

                grids.forEach((grid) => {
                    let tierHeader = grid.previousElementSibling;
                    while (tierHeader && (tierHeader.tagName.toLowerCase() !== 'h2' || !tierHeader.getAttribute('class') || !tierHeader.getAttribute('class').includes('header'))) {
                        tierHeader = tierHeader.previousElementSibling;
                    }
                    let currentTier = tierHeader ? (tierHeader.textContent.trim() || "") : "";
                    if (!currentTier && tierHeader) {
                        const dataTier = tierHeader.getAttribute('data-tier') || "";
                        const tierMap = { '1': '1-Star Raids', '3': '3-Star Raids', '5': '5-Star Raids', 'mega': 'Mega Raids' };
                        currentTier = tierMap[dataTier.toLowerCase()] || dataTier;
                    }

                    const cards = grid.querySelectorAll('div.card');
                    cards.forEach((card) => {
                            let boss = {
                                name: "",
                                tier: currentTier,
                                canBeShiny: false,
                                types: [],
                                combatPower: {
                                    normal: { min: -1, max: -1 },
                                    boosted: { min: -1, max: -1 }
                                },
                                boostedWeather: [],
                                image: ""
                            };

                            // Name
                        const nameEl = card.querySelector('p.name') || card.querySelector('.identity .name');
                        boss.name = nameEl ? (nameEl.textContent.trim() || "") : "";

                            // Image
                        boss.image = card.querySelector('div.boss-img img')?.src || "";

                            // Shiny
                        boss.canBeShiny = !!card.querySelector('div.boss-img .shiny-icon');

                            // Types
                        card.querySelectorAll('div.boss-type img, div.boss-type .type img').forEach((img) => {
                            const typeName = img.getAttribute('title') || img.getAttribute('alt') || "";
                            if (typeName) {
                                boss.types.push({
                                    name: typeName.toLowerCase(),
                                    image: img.src || ""
                                });
                            }
                            });

                            // Combat Power (normal)
                        let cpText = (card.querySelector('div.cp-range')?.textContent || "").replace(/^CP\s*/i, "").trim();
                        let [cpMin, cpMax] = cpText.split('-').map(s => parseInt(s.trim(), 10));
                            boss.combatPower.normal.min = cpMin || -1;
                            boss.combatPower.normal.max = cpMax || -1;

                            // Combat Power (boosted)
                        let boostedText = (card.querySelector('div.boosted-cp-row .boosted-cp, div.boosted-cp-row span.boosted-cp')?.textContent || "").replace(/^CP\s*/i, "").trim();
                        let [boostMin, boostMax] = boostedText.split('-').map(s => parseInt(s.trim(), 10));
                            boss.combatPower.boosted.min = boostMin || -1;
                            boss.combatPower.boosted.max = boostMax || -1;

                            // Boosted Weather
                        const weatherContainer = card.querySelector('div.weather-boosted') || card.querySelector('div.boss-3');
                        (weatherContainer?.querySelectorAll('.boss-weather img, .weather-pill img') || []).forEach((img) => {
                            let weatherName = (img.getAttribute('alt') || "").toLowerCase();
                            if (!weatherName && img.getAttribute('src')) {
                                const match = img.getAttribute('src').match(/(\w+)\.png$/);
                                weatherName = match ? match[1].toLowerCase() : "";
                            }
                            if (weatherName) {
                                boss.boostedWeather.push({
                                    name: weatherName,
                                    image: img.src || ""
                                });
                            }
                            });

                            bosses.push(boss);
                        });
                    });

                addBossesOngoingElsewhere(bosses).then(finalBosses => {
                    writeBosses(finalBosses);
                });
            }).catch(_err => {
                console.log(_err);
                https.get("https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/raids.min.json", (res) => {
                    let body = "";
                    res.on("data", (chunk) => { body += chunk; });

                    res.on("end", () => {
                        try {
                            let json = JSON.parse(body);

                            fs.writeFile('files/raids.json', JSON.stringify(json, null, 4), err => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                            });
                            fs.writeFile('files/raids.min.json', JSON.stringify(json), err => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                            });
                        }
                        catch (error) {
                            console.error(error.message);
                        };
                    });

                }).on("error", (error) => {
                    console.error(error.message);
                });
            });
    })
}

module.exports = { get }
