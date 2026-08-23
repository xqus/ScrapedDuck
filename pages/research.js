const fs = require('fs');
const jsd = require('jsdom');
const { JSDOM } = jsd;
const https = require('https');

/**
 * Splits a reward label into its item name and quantity.
 *
 * LeekDuck writes quantities into the reward label rather than a dedicated
 * element, and does it several different ways ("1000 Stardust",
 * "Ultra Ball x20", "\u00d73 Rare Candy"). Anything that doesn't carry a
 * quantity keeps the whole label as the name and reports a null amount.
 */
function splitRewardAmount(label)
{
    var text = label.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

    var trailing = text.match(/^(.+?)\s*[x\u00d7]\s*([\d.,]+)$/i);
    if (trailing != null)
    {
        var trailingAmount = toAmount(trailing[2]);
        if (trailingAmount != null)
            return { name: trailing[1].trim(), amount: trailingAmount };
    }

    var leadingMultiplier = text.match(/^[x\u00d7]\s*([\d.,]+)\s+(.+)$/i);
    if (leadingMultiplier != null)
    {
        var leadingMultiplierAmount = toAmount(leadingMultiplier[1]);
        if (leadingMultiplierAmount != null)
            return { name: leadingMultiplier[2].trim(), amount: leadingMultiplierAmount };
    }

    var leadingNumber = text.match(/^([\d.,]+)\s+(.+)$/);
    if (leadingNumber != null)
    {
        var leadingNumberAmount = toAmount(leadingNumber[1]);
        if (leadingNumberAmount != null)
            return { name: leadingNumber[2].trim(), amount: leadingNumberAmount };
    }

    return { name: text, amount: null };
}

function toAmount(raw)
{
    var value = parseInt(raw.replace(/[.,\s]/g, ""), 10);
    return isNaN(value) ? null : value;
}

/**
 * Builds an item reward from a `.reward` node that isn't a Pokemon encounter
 * (stardust, candy, TMs, berries, mega energy, ...). Returns null when the node
 * carries no usable label.
 */
function parseItemReward(r)
{
    var labelNode = r.querySelector(":scope > .reward-label > span") || r.querySelector(":scope > .reward-label");
    if (labelNode == null)
        return null;

    var label = labelNode.textContent.trim();
    if (label == "")
        return null;

    var imageNode = r.querySelector(":scope > .reward-bubble > .reward-image") || r.querySelector(".reward-image");
    var split = splitRewardAmount(label);

    return {
        name: split.name,
        image: imageNode != null ? imageNode.src : "",
        amount: split.amount
    };
}

function get()
{
    return new Promise(resolve => {
        JSDOM.fromURL("https://leekduck.com/research/", {
        })
        .then((dom) => {

            var taskNameToID = [];
            taskNameToID["Event Tasks"] = "event";
            taskNameToID["Catching Tasks"] = "catch";
            taskNameToID["Throwing Tasks"] = "throw";
            taskNameToID["Battling Tasks"] = "battle";
            taskNameToID["Exploring Tasks"] = "explore";
            taskNameToID["Training Tasks"] = "training";
            taskNameToID["Team GO Rocket Tasks"] = "rocket";
            taskNameToID["Buddy &amp; Friendship Tasks"] = "buddy";
            taskNameToID["AR Scanning Tasks"] = "ar";
            taskNameToID["Sponsored Tasks"] = "sponsored";


            var types = dom.window.document.querySelectorAll('.task-category');

            var research = [] 
            
            types.forEach (_e =>
            {
                _e.querySelectorAll(":scope > .task-list > .task-item").forEach(task => {
                    var text = task.querySelector(":scope > .task-text").innerHTML.trim();
                    var type = taskNameToID[_e.querySelector(":scope > h2").innerHTML.trim()];

                    var rewards = [];
                    var items = [];

                    task.querySelectorAll(":scope > .reward-list > .reward").forEach(r => {
                        if (r.dataset.rewardType == "encounter")
                        {
                            var reward = { 
                                name: "",
                                image: "",
                                canBeShiny: false,
                                combatPower: {
                                    min: -1,
                                    max: -1
                                }
                            };

                            reward.name = r.querySelector(":scope > .reward-label > span").innerHTML.trim();
                            reward.image = r.querySelector(":scope > .reward-bubble > .reward-image").src;

                            reward.combatPower.min = parseInt(r.querySelector(":scope > .cp-values > .min-cp").innerHTML.trim().split("</div>")[1]);
                            reward.combatPower.max = parseInt(r.querySelector(":scope > .cp-values > .max-cp").innerHTML.trim().split("</div>")[1]);
                            reward.canBeShiny = r.querySelector(":scope > .reward-bubble > .shiny-icon") != null;

                            rewards.push(reward);
                        }
                        else
                        {
                            var item = parseItemReward(r);

                            if (item != null)
                                items.push(item);
                        }
                    });

                    if (rewards.length > 0 || items.length > 0)
                    {
                        var foundResearch = research.findIndex(fr => { return fr.text == text && fr.type == type });

                        if (foundResearch > -1)
                        {
                            rewards.forEach(rw => {
                                research[foundResearch].rewards.push(rw);
                            });

                            if (items.length > 0)
                            {
                                if (research[foundResearch].items == undefined)
                                    research[foundResearch].items = [];

                                items.forEach(it => {
                                    research[foundResearch].items.push(it);
                                });
                            }
                        }
                        else
                        {
                            var entry = { "text": text, "type": type, "rewards": rewards };

                            if (items.length > 0)
                                entry.items = items;

                            research.push(entry);
                        }
                    }
                });
            });

            fs.writeFile('files/research.json', JSON.stringify(research, null, 4), err => {
                if (err) {
                    console.error(err);
                    return;
                }
            });
            fs.writeFile('files/research.min.json', JSON.stringify(research), err => {
                if (err) {
                    console.error(err);
                    return;
                }
            });
        }).catch(_err =>
            {
                console.log(_err);
                https.get("https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/research.min.json", (res) =>
                {
                    let body = "";
                    res.on("data", (chunk) => { body += chunk; });
                
                    res.on("end", () => {
                        try
                        {
                            let json = JSON.parse(body);
    
                            fs.writeFile('files/research.json', JSON.stringify(json, null, 4), err => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                            });
                            fs.writeFile('files/research.min.json', JSON.stringify(json), err => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                            });
                        }
                        catch (error)
                        {
                            console.error(error.message);
                        };
                    });
                
                }).on("error", (error) => {
                    console.error(error.message);
                });
            });
    })
}

module.exports = { get, parseItemReward, splitRewardAmount }