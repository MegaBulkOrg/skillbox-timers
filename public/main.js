/*global UIkit, Vue */

(() => {
  let client = null;

  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
    },
    methods: {
      createTimer() {
        const description = this.desc;
        this.desc = "";
        this.client.send(
          JSON.stringify({
            type: "create_timer",
            description
          })
        );
      },
      stopTimer(id) {
        this.client.send(
          JSON.stringify({
            type: "stop_timer",
            id
          })
        );
      },
      formatTime(ts) {
        const timestamp = Number(ts);
        return new Date(timestamp).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {
      // создаем соединение
      const wsProto = location.protocol === "https:" ? "wss" : "ws:";
      const client = new WebSocket(`${wsProto}//${location.host}`);
      this.client = client;
      // обрабатываем сообщения
      client.addEventListener("message", (message) => {
        let data;
        try {
          data = JSON.parse(message.data);
        } catch (error) {
          return;
        }
        if (data.type === "all_timers") {
          this.activeTimers = data.activeTimers;
          this.oldTimers = data.oldTimers;
        }
        if (data.type === "active_timers") {
          this.activeTimers = data.activeTimers;
        }
        if (data.type === "timer_created") {
          info(`Created new timer "${data.newTimer.description}" [${data.newTimer.timer_id}]`);
        }
        if (data.type === "timer_stoped") {
          info(`Stopped the timer [${data.timer_id}]`);
        }
      });
    },
  });
})();
