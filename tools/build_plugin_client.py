"""生成 DSH 浏览器插件客户端：把三张姿态图内联成 base64，避免宿主静态路由问题。

用法: python tools/build_plugin_client.py
输出: packages/plugin-dsh/lib/client.js
"""
import base64
import io
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR = os.path.join(ROOT, "assets", "char")
OUT = os.path.join(ROOT, "packages", "plugin-dsh", "lib", "client.js")

TARGET_SCALE = 0.75  # 素材是 2 倍图，压到 1.5 倍

POSES = {
    "idle": "pose_idle.png",
    "happy": "pose_happy.png",
    "sleep": "pose_sleep.png",
}


def data_url(path):
    img = Image.open(path).convert("RGBA")
    w = round(img.size[0] * TARGET_SCALE)
    h = round(img.size[1] * TARGET_SCALE)
    img = img.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


TEMPLATE = r"""/**
 * 小肥鱼 · DSH 浏览器外壳。
 * 注册点：shell.overlay（悬浮层），在界面右下角画一只会呼吸的小肥鱼。
 * 这个文件由 tools/build_plugin_client.py 生成，请改模板而不是直接改这里。
 */
window.__ModuleLoader__.load({
  id: 'dsh-yourdeepfish',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var h = React.createElement;

    var NS = 'yourdeepfish';
    var POSES = {
      idle: '__IDLE__',
      happy: '__HAPPY__',
      sleep: '__SLEEP__',
    };
    var LINES = [
      '主人，您回来啦。茶已经沏好了……才、才不是特意等您呢。',
      '欢迎回来，主人。房间打扫过了，杯子也擦干净了。',
      '哼、主人怎么才回来！我才没有等很久。',
      '主人，已经坐了很久了。起来活动一下比较好。',
    ];

    var W = 220;
    var H = 300;

    function PetOverlay() {
      var canvasRef = React.useRef(null);
      var bubbleRef = React.useRef(null);
      var stateRef = React.useRef({ pose: 'idle', happyUntil: 0, lastClick: 0 });

      React.useEffect(function () {
        var canvas = canvasRef.current;
        if (!canvas) return undefined;
        var ctx = canvas.getContext('2d');
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);

        var images = {};
        Object.keys(POSES).forEach(function (key) {
          var img = new Image();
          img.src = POSES[key];
          img.onload = function () {
            images[key] = img;
          };
        });

        var raf = 0;
        var start = performance.now();

        function frame(now) {
          var t = (now - start) / 1000;
          var st = stateRef.current;
          if (st.happyUntil && now > st.happyUntil) {
            st.happyUntil = 0;
            st.pose = 'idle';
          }
          var pose = st.pose === 'happy' ? 'happy' : st.pose;
          var img = images[pose] || images.idle;
          ctx.clearRect(0, 0, W, H);
          if (img) {
            var breath = Math.sin((t * Math.PI * 2) / 3.4);
            var sway = Math.sin((t * Math.PI * 2) / 4.8);
            var hh = 280;
            var ww = (hh * img.width) / img.height;
            ctx.save();
            ctx.translate(W / 2, H - 6);
            ctx.rotate(sway * 0.012);
            ctx.scale(1 + 0.012 * breath, 1 - 0.016 * breath);
            ctx.drawImage(img, -ww / 2, -hh, ww, hh);
            ctx.restore();
          }
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
        return function () {
          cancelAnimationFrame(raf);
        };
      }, []);

      function onClick() {
        var st = stateRef.current;
        st.pose = 'happy';
        st.happyUntil = performance.now() + 3000;
        var bubble = bubbleRef.current;
        if (bubble) {
          bubble.textContent = LINES[Math.floor(Math.random() * LINES.length)];
          bubble.style.opacity = '1';
          clearTimeout(st.timer);
          st.timer = setTimeout(function () {
            bubble.style.opacity = '0';
          }, 6000);
        }
      }

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            right: '28px',
            bottom: '16px',
            width: W + 'px',
            height: H + 'px',
            zIndex: 60,
            pointerEvents: 'none',
          },
        },
        h('div', {
          ref: bubbleRef,
          style: {
            position: 'absolute',
            top: '0px',
            left: '0px',
            width: (W - 12) + 'px',
            padding: '8px 12px',
            borderRadius: '14px',
            background: 'rgba(255,255,255,0.96)',
            color: '#2b3a67',
            font: '12.5px/1.5 "Microsoft YaHei", sans-serif',
            boxShadow: '0 6px 18px rgba(38,64,140,0.22)',
            opacity: 0,
            transition: 'opacity .2s ease',
            pointerEvents: 'none',
          },
        }),
        h('canvas', {
          ref: canvasRef,
          onClick: onClick,
          style: {
            width: W + 'px',
            height: H + 'px',
            pointerEvents: 'auto',
            cursor: 'pointer',
          },
        }),
      );
    }

    function apply(ctx) {
      // 注册失败不能让整个 web boot 挂掉：宿主把 apply 抛错当成 entry failed，
      // 会直接阻断启动。这里兜住所有异常，只在控制台留一条记录。
      try {
        if (!ctx || !ctx.slots) {
          console.error('[yourdeepfish] ctx.slots 不可用，跳过悬浮层注册');
          return;
        }
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-yourdeepfish', order: 90 },
            PetOverlay,
          );
        });
      } catch (error) {
        console.error('[yourdeepfish] 注册悬浮层失败:', error);
      }
    }

    exports.apply = apply;
    exports.NS = NS;
    return module.exports;
  },
});
"""


def main():
    assets = {k: data_url(os.path.join(CHAR, v)) for k, v in POSES.items()}
    js = TEMPLATE
    for key, url in assets.items():
        js = js.replace('__' + key.upper() + '__', url)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(js)
    print('wrote', OUT, round(os.path.getsize(OUT) / 1024, 1), 'KB')


if __name__ == '__main__':
    main()
