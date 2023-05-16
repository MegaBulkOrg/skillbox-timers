const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
require("dotenv").config();
// новые пакеты
const http = require("http");
const WebSocket = require("ws");
const cookie = require("cookie");

// СЕРВЕРА
// -- express
const app = express();
app.use(express.json());
app.use(express.static("public"));
// -- HTTP сервер
const server = http.createServer(app);
// -- WebSocket
const wss = new WebSocket.Server({ clientTracking: false, noServer: true });

const clients = new Map();

const knex = require("knex")({
  client: "pg",
  // если файлы проекта содержат миграции то прописывать для Knex подключение к БД нужно в 2 местах
  // тут объект connection нужен для методов knex которые получают данные из БД
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  // у elephantsql.com существует ограничение на одновременные подключения к БД - не больше 3
  pool: { min: 0, max: 3 },
});

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});
app.set("view engine", "njk");

app.use(cookieParser());
const auth = () => async (req, res, next) => {
  if (!req.cookies["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.cookies["sessionId"]);
  req.user = user;
  req.sessionId = req.cookies["sessionId"];
  next();
};

app.get("/", auth(), async (req, res) => {
  try {
    const user = await req.user;
    res.render("index", {
      // эта строчка нужна чтобы передать данные в NunJucks шаблон
      // эти данные пользователя используются на странице (файл views/index.njk, строка "User: [[ user.username ]].")
      user: user,
      // оповещения
      authError: req.query.authError === "true" ? "Wrong username or password" : null,
      signupError: req.query.signupError === "true" ? "User with this login has been already added to database" : null,
      newUser: req.query.newUser === "true" ? "New user is created" : null,
    });
  } catch (error) {
    console.log("Проблема в корневой ручке", error);
  }
});


/*
  ТАЙМЕРЫ
*/
// Вспомогательные методы
const getActiveTimers = async (userId) => {
  const activeTimers = await knex("timers").select().where({ is_active: true });
  activeTimers.forEach(async (timer) => {
    await knex("timers")
      .where({ id: timer.id })
      .update({ progress: Date.now() - timer.start_timestamp });
  });
  const activeTimersWithProgress = await knex("timers").select().where({
    is_active: true,
    user_id: userId ,
  });
  return activeTimersWithProgress
}
const getOldTimers = async (userId) => {
    const oldTimers = await knex("timers").select().where({
    is_active: false,
    user_id: userId ,
  });
  return oldTimers
}


/*
  ПОЛЬЗОВАТЕЛИ
  !!  в таблице users я не стал делать 2 ID для пользователя - есть лишь ID который формируется автоматически !!
*/
// Вспомогательные методы
const findUserByLogin = async (username) => {
  return await knex("users")
    .select()
    .where({ username })
    .limit(1)
    .then((results) => results[0]);
};
const findUserBySessionId = async (sessionId) => {
  // тут ситуация когда для изменения одной ячейки нужно получить данные другой ячейки этой же строки
  // я придумал лишь сделать 2 запроса и такой способ оказался подходящим (нет способа лучше)
  const session = await knex("sessions")
    .select("user_id")
    .where({ session_id: sessionId })
    .limit(1)
    .then((results) => results[0]);
  if (!session) {
    return;
  }
  // вопрос: почему тут вставляем "session.user_id" а не просто "session" - ведь в первом запросе выбирается только поле "user_id"
  // ответ: в переменной session получаем не просто значение поля "user_id" а объект { user_id: 1 } и поэтому чтобы вытащить значение поля "user_id"
  //        нужно писать то что на первый взгляд кажется маслом масленным
  return await knex("users")
    .select()
    .where({ id: session.user_id })
    .limit(1)
    .then((results) => results[0]);
};
const createSession = async (userId) => {
  const sessionId = nanoid();
  await knex("sessions").insert({
    user_id: userId,
    session_id: sessionId,
  });
  return sessionId;
};
const deleteSession = async (sessionId) => {
  await knex("sessions").where({ session_id: sessionId }).delete();
};

// Регистрация
app.post(
  "/signup",
  bodyParser.urlencoded({
    extended: false,
  }),
  async (req, res) => {
    // получаем введенные данные
    const { username, password } = req.body;
    // проверяем есть ли уже такой пользователь в базе
    if (await findUserByLogin(username)) {
      return res.redirect("/?signupError=true");
    } else {
      const newUser = {
        username: username,
        password: crypto.createHash("sha256").update(password).digest("hex"),
      };
      await knex("users").insert(newUser);
      return res.redirect("/?newUser=true");
    }
  }
);

// Вход
// -- ручка
app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const passToCompare = crypto.createHash("sha256").update(password).digest("hex");
  const user = await findUserByLogin(username);
  if (!user || user.password !== passToCompare) {
    return res.redirect("/?authError=true");
  }
  const sessionId = await createSession(user.id);
  res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
});
// -- событие upgrade
server.on("upgrade", async (req, socket, head) => {
  const cookies = cookie.parse(req.headers["cookie"]);
  const sessionId = cookies && cookies["sessionId"];
  const user = await findUserBySessionId(sessionId);
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  req.userId = user.id;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
// -- событие connection
wss.on("connection", async (ws, req) => {
  const { userId } = req;
  clients.set(userId, ws);
  ws.on("close", () => {
    clients.delete(userId);
  });
  // выносим получение таймеров в отдельный метод
  const getAllTimers = async () => {
    const activeTimers = await getActiveTimers(userId);
    const oldTimers = await getOldTimers(userId);
    ws.send(
      JSON.stringify({
        type: "all_timers",
        activeTimers,
        oldTimers
      })
    );
  };

  // после подключения сервер должен один раз послать этому клиенту
  // через веб-сокет актуальный список таймеров этого клиента
  getAllTimers();
  // каждую секунду сервер должен посылать каждому клиенту через веб-сокет
  // актуальный список активных таймеров этого клиента
  setInterval(async () => {
    const activeTimers = await getActiveTimers(userId);
    ws.send(
      JSON.stringify({
        type: "active_timers",
        activeTimers
      })
    );
  }, 1000);

  // СООБЩЕНИЯ
  ws.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      return;
    }
    // создание таймера
    if (data.type === "create_timer") {
      const newTimer = {
        timer_id: nanoid(),
        user_id: userId,
        description: data.description,
        start_timestamp: Date.now(),
        is_active: true,
      };
      await knex("timers").insert(newTimer);
      ws.send(
        JSON.stringify({
          type: 'timer_created',
          newTimer
        })
      );
      getAllTimers();
    }
    // остановка таймера
    if (data.type === "stop_timer") {
      const timer_id = data.id;
      const timerToStop = await knex("timers")
        .select("start_timestamp")
        .where({ id: timer_id })
        .limit(1)
        .then((results) => results[0]);
      await knex("timers")
        .where({ id: timer_id })
        .update({
          end_timestamp: Date.now(),
          duration: Date.now() - timerToStop.start_timestamp,
          is_active: false,
        });
      ws.send(
        JSON.stringify({
          type: 'timer_stoped',
          timer_id
        })
      );
      getAllTimers();
    }
  });
});

// Выход
app.get("/logout", auth(), async (req, res) => {
  // если пользователя нет
  if (!req.user) {
    return res.redirect("/");
  }
  // в противном случае завершаем сессию
  await deleteSession(req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Приложение запустилось по адресу http://localhost:${port}`);
});
