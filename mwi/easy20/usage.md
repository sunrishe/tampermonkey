## 功能说明

### 自由强化

选择强化物品和配装，自由地添加强化任务。

#### 使用说明

1. **【极其重要】** 强化等级对应的物品必须存在，否则发起任务无响应页面假死，可以点击停止任务中止。
2. **【重要】** 不会检测库存，添加任务时请确保基础物品及强化资源足够，否则强化任务会提前结束。
3. 保护之镜强化会读取页面选择的配装方案，贤者之镜强化则使用无配装。
4. 使用页面选择的保护物品，请确保物品数量充足。
5. 不建议使用福气茶，会出现预估外的物品。
6. 不建议添加过多队列，否则等待时间会很长。

### 批量强化基底

选择强化物品、基底等级对和目标等级，根据库存物品强化等级及数量自动计算强化所需基底数量并批量添加强化任务。

#### 使用说明

1. **【重要】** 请准备充足的强化材料，否则强化任务会提前结束，后续强化队列清空。
2. 自动检测库存中物品是否充足，不足时会给出提示，不会检测已经装备的物品。
3. 计算强化队列会减掉库存内高于基底等级的物品数量。
4. 添加基底强化任务会使用页面选择的配装方案。
5. 使用页面选择的保护物品，请确保物品数量充足。
6. 不会检测任务队列，使用插件前建议先清空任务队列，否则会合成超过所需数量的物品。
7. 不建议使用福气茶，会出现预估外的物品。
8. 不要选择精炼物品进行强化，因为精炼物品强化需要普通物品升级，可以通过【炼金-解精炼】去掉精炼。

### 批量合成

根据库存物品强化等级计算合成目标等级的强化任务序列，批量添加使用贤者之镜的强化任务。

#### 使用说明

1. **【重要】** 请准备充足的贤者之镜。
2. 贤者之镜强化使用无配装，因为配装方案的自动使用高等级和福气茶可能导致合成失败。
3. 不要选择精炼物品进行合成。
4. 不要使用福气茶，会出现预估外的物品，导致合成失败。
5. 合成队列添加失败可以等待现有队列执行完成后，再次点击合成按钮，会根据已有物品重新计算合成队列。


## Features

### Custom Enhancing

Select equipment and a Loadout, then add custom enhancing actions.

#### Notes

1. **[Critical]** The item at the selected enhancement level must exist, otherwise the queued action may not respond. Click **Stop Task** to stop it.
2. **[Important]** Inventory is not checked. Make sure base items and enhancing materials are enough, otherwise the enhancing action may end early.
3. Mirror Of Protection enhancing uses the selected Loadout. Philosopher's Mirror enhancing uses No Loadout.
4. Make sure you have enough selected protection items.
5. Blessed Tea is not recommended because it may create unexpected items.
6. Avoid adding too many Queued Actions, or waiting may take a long time.

### Batch Enhance Bases

Select equipment, base level pair, and target level. The script calculates required bases from inventory enhancement levels and counts, then adds enhancing actions in batches.

#### Notes

1. **[Important]** Prepare enough enhancing materials, otherwise the action may end early and later Queued Actions may be cleared.
2. Inventory items are checked automatically. Equipped items are not checked.
3. The queue calculation subtracts inventory items higher than the base level.
4. Base enhancing actions use the selected Loadout.
5. Make sure you have enough selected protection items.
6. The Action Queue is not checked. Clear it before using this script to avoid creating extra items.
7. Blessed Tea is not recommended because it may create unexpected items.
8. Do not select refined items. Enhancing refined items requires normal items. Use **Alchemy - Unrefine** first.

### Batch Merge

Calculate the sequence needed to merge to the target level from inventory enhancement levels, then add Philosopher's Mirror enhancing actions in batches.

#### Notes

1. **[Important]** Prepare enough Philosopher's Mirrors.
2. Philosopher's Mirror enhancing uses No Loadout because auto higher-level items and Blessed Tea in Loadouts may cause merge failure.
3. Do not select refined items for merge.
4. Do not use Blessed Tea, because unexpected items may cause merge failure.
5. If adding the merge queue fails, wait for the current Queued Actions to finish and click merge again. The queue will be recalculated from current items.
