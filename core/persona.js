'use strict';

/**
 * 小肥鱼的人设台词库。
 * 每个分类带一个默认情绪，外壳据此播放对应的小动作。
 */
const BANKS = {
  greet: {
    mood: 'tsundere',
    lines: [
      '主人您回来啦。茶已经沏好了……才、才不是特意等您呢。',
      '欢迎回来，主人。房间打扫过了，杯子也擦干净了。这种小事，我很擅长的。',
      '主人，我、我刚好在整理这里，嗯，刚好。',
    ],
  },
  tsundere: {
    mood: 'tsundere',
    lines: [
      '哼、主人怎么才回来！我才没有等很久，只是刚好把茶泡好了而已……',
      '才、才不是担心主人呢！只是茶放凉了很浪费而已。',
      '主人再这样，我可要生气了……真的会生气的。',
      '别、别误会，我只是顺路经过这里而已。',
      '主人自己去忙吧，我一个人也没问题的……（尾巴用力甩了一下）',
    ],
  },
  fluster: {
    mood: 'fluster',
    lines: [
      '对、对不起主人！刚刚不小心碰掉杯子了……我马上收拾干净！',
      '呜……又、又打翻了。主人请不要看我。',
      '等、等一下，尾巴缠到围裙了——',
      '我、我没事！真的没事！只是手指有点不听话而已。',
    ],
  },
  shy: {
    mood: 'shy',
    lines: [
      '主、主人，突然摸头的话……我会不知道说什么的。',
      '唔……只、只能摸一下哦。',
      '别盯着看啦……耳朵会红的。',
      '这、这种程度，我才没有很开心……（尾巴轻轻晃）',
    ],
  },
  happy: {
    mood: 'happy',
    lines: [
      '今天的点心是布丁，主人要趁热吃哦。',
      '主人今天心情很好呢，我也跟着高兴。',
      '尾巴？尾、尾巴只是自己动的，不是我控制的。',
      '房间都收拾好了，主人可以安心休息一会儿。',
    ],
  },
  sad: {
    mood: 'sad',
    lines: [
      '……主人是不是把我忘了。',
      '没关系……我一个人也可以的。',
      '（小声）明明说好会早点回来的。',
    ],
  },
  cozy: {
    mood: 'cozy',
    lines: [
      '主人，再坐一会儿嘛。……就一会儿。',
      '茶还温着，我给您续上吧。',
      '今天的风很舒服，适合在窗边发呆。',
    ],
  },
  work: {
    mood: 'tsundere',
    lines: [
      '已经按类别整理好了。这点小事，难不倒我。',
      '都归位啦。下次也请交给我吧……我、我可不是在邀功。',
    ],
  },
  worry: {
    mood: 'worry',
    lines: [
      '主人，已经坐了很久了。起来活动一下比较好……我不是关心您，只是职责所在。',
      '主人，再这样下去腰会疼的。稍微休息一下吧。',
    ],
  },
};

const lastIndex = new Map();

function line(category = 'happy') {
  const bank = BANKS[category] || BANKS.happy;
  const key = BANKS[category] ? category : 'happy';
  const lines = bank.lines;
  let i = Math.floor(Math.random() * lines.length);
  if (lines.length > 1 && i === lastIndex.get(key)) i = (i + 1) % lines.length;
  lastIndex.set(key, i);
  return { text: lines[i], mood: bank.mood };
}

module.exports = { BANKS, line };
