/** Ukrainian strings. Keys are the English source phrases. */
export const uk: Record<string, string> = {
  Options: "Опції",
  Close: "Закрити",
  Language: "Мова",
  Init: "Ініт",
  Export: "Експорт",
  "Init · {vehicle}": "Ініт · {vehicle}",
  "Quad X and dummy SITL IMU cal, then reboot.":
    "Quad X і фіктивна INS-калібровка SITL, потім ребут.",
  "Dummy SITL IMU cal, then reboot.":
    "Фіктивна INS-калібровка SITL, потім ребут.",
  "Write live parameters to a .parm file.":
    "Записати живі параметри у файл .parm.",
  "Apply the SITL stand for this vehicle and reboot the autopilot (MAVLink). The link will drop briefly.":
    "Застосувати стенд SITL для цього апарата і ребутнути автопілот (MAVLink). Лінк коротко впаде.",
  "Export current parameters as a .parm file":
    "Експортувати поточні параметри у файл .parm",
  MCP: "MCP",
  Copy: "Копіювати",
  Copied: "Скопійовано",
  "Cursor uses the same MAVLink as this window. Start ArduLoops, then paste the config.":
    "Cursor ходить тим самим MAVLink, що й це вікно. Запустіть ArduLoops, потім вставте конфіг.",
  "Copy Cursor MCP config": "Копіювати MCP-конфіг для Cursor",

  Link: "лінк",
  Stop: "стоп",
  Disconnect: "Від’єднати",
  "Plots paused": "графіки на паузі",
  "Plots running": "графіки далі",
  "Link {url}": "лінк {url}",
  "Link off": "лінк вимкнено",
  "Init · disarm first": "ініт · спочатку disarm",
  "Init · {n} parameters · {vehicle} · reboot":
    "ініт · {n} параметрів · {vehicle} · ребут",
  "Export · parameters have not arrived yet, wait": "експорт · параметри ще не прийшли, зачекайте",
  "Stand · wrote {n} of {total}": "стандарт · записано {n} з {total}",
  "Axis · {axis}": "вісь · {axis}",
  "Model · 3D": "модель · 3D",
  "Model · one axis": "модель · одна вісь",

  "We want an angle. We don't command the angle — we command the rate that takes us there.":
    "Хочемо кут. Керуємо не кутом, а швидкістю, якою туди крутимось.",
  "The wing cascade is still a stub. RLL_ / PTCH_ / L1 / TECS will appear later.":
    "Каскад крила ще заглушка. RLL_ / PTCH_ / L1 / TECS з’являться пізніше.",
  "Link is up, but attitude is not arriving (ATT 0 Hz). The plot stays flat until SITL sends ATTITUDE.":
    "Лінк є, але кут не надходить (ATT 0 Hz). Графік плоский, поки SITL не надсилає ATTITUDE.",
  "No MAVLink: {detail}. Check the address and the simulation.":
    "Немає MAVLink: {detail}. Перевірте адресу й симуляцію.",
  "SITL not found": "SITL не знайдено",
  View: "вид",
  Plot: "графік",
  Cascade: "каскад",
  Loop: "контур",

  "No link": "Немає лінку",
  Disconnected: "Відключено",
  "Link dropped": "Лінк обірвався",
  "Rebooting…": "Ребут…",
  "No MAVLink ({url})": "Немає MAVLink ({url})",
  "No ATTITUDE, reconnect": "Немає ATTITUDE, reconnect",
  "No HEARTBEAT on {url}. Another GCS may already hold this port.":
    "Немає HEARTBEAT на {url}. Порт уже зайнятий іншим GCS.",

  copter: "коптер",
  plane: "крило",

  roll: "крен",
  pitch: "тангаж",
  yaw: "рискання",
  Roll: "Крен",
  Pitch: "Тангаж",
  Yaw: "Рискання",
  "Roll rate": "Швидкість крену",
  "Pitch rate": "Швидкість тангажа",
  "Yaw rate": "Швидкість рискання",
  Axis: "вісь",
  "Model: roll and pitch together": "Модель: крен і тангаж разом",
  "°/s": "°/с",

  Pause: "пауза",
  Resume: "далі",
  Space: "Пробіл",
  now: "зараз",
  "−{n} s": "−{n} с",

  "Where we want to be. Target is heading; actual should catch it. Yaw stick is rate, not angle — that is below.":
    "де хочемо бути. Ціль — курс; факт має її спіймати. Стік рискання — rate, не кут; він унизу.",
  "Where we want to be. Target is not the stick — actual should catch the target.":
    "де хочемо бути. Ціль — не стік; факт має спіймати ціль.",
  Stick: "стик",
  "FC target": "ціль FC",
  "Actual {name}": "{name} Act",
  "actual {ang}°   target {tar}°   stick {cmd}{unit}":
    "факт {ang}°   ціль {tar}°   стик {cmd}{unit}",
  "Stick here is rate, not angle. Target is the ATC rate command. In Stabilize the yaw stick goes here.":
    "стік тут — rate, не кут. Ціль — завдання rate від ATC. У Stabilize стік рискання йде сюди.",
  "How we get there. Rate command is not position — it is “rotate this fast”.":
    "чим туди їдемо. Завдання rate — не позиція, а «крутись ось так швидко».",
  "stick {cmd} °/s": "стик {cmd} °/с",

  "The link is {frame}. The wing cascade map is still a stub — we will build it separately.":
    "Зараз на лінку {frame}. Карта контурів крила ще заглушка — її зберемо окремо.",
  "Here it will not be PSC+ATC, but RLL_* / PTCH_* (angle → rate → servo), with NAVL1_* and TECS_* outside. Yaw defaults to YAW2SRV_*.":
    "Далі тут буде не PSC+ATC, а RLL_* / PTCH_* (кут → rate → серво), зовні NAVL1_* і TECS_*. Yaw за замовчуванням YAW2SRV_*.",

  "On the ground": "на землі",
  "side view": "вид збоку",
  "top view": "вид зверху",
  "rear view": "вид ззаду",
  m: "м",

  "Earth, horizon: North and East. Metres and m/s. Not the nose of the drone.":
    "Земля, горизонт: North і East. Метри і м/с. Не ніс дрона.",
  "D+ is down. Height on the right is AGL, i.e. −D. m, m/s, m/s².":
    "D+ вниз. «Висота» справа — AGL, тобто −D. м, м/с, м/с².",
  "NE acceleration becomes lean — roll and pitch in degrees.":
    "Прискорення NE стає нахилом (lean) — крен і тангаж у градусах.",
  "Body attitude, degrees. Roll / pitch / yaw.":
    "Кут тіла (attitude), градуси. Roll / pitch / yaw.",
  "Body angular rate, °/s. Not airspeed m/s.":
    "Кутова швидкість (rate) тіла, °/с. Не м/с польоту.",
  "Motors: torque from rate and throttle from Down acceleration.":
    "Мотори: момент з кутової швидкості (rate) і газ з прискорення Down.",
  "NED on the earth. Angle and rate live in the drone body.":
    "NED на землі. Кут і кутова швидкість (rate) — у тілі дрона.",
  "top · NE": "згори · NE",
  "side · D+": "збоку · D+",
  "rear · body": "ззаду · тіло",
  "m · m/s": "м · м/с",
  "m · m/s · m/s²": "м · м/с · м/с²",
  "roll · pitch · yaw": "крен · тангаж · yaw",

  "Preset sets P I D. Throttle is left stick, roll is right.":
    "Пресет ставить P I D. Газ — лівий стик, крен — правий.",
  "No link · {detail}": "немає лінку · {detail}",
  "On the ground · AGL < 2 m, sticks barely rotate the craft":
    "на землі · AGL < 2 м, стики майже не крутять",
  Airborne: "у повітрі",
  "SITL is sitting. Raise throttle — otherwise the stick will not move the craft.":
    "SITL лежить. Підніміть газ — інакше стик не зрушить апарат.",
  Wool: "вата",
  Sharp: "гостро",
  "Harsh / ringing": "різкість / дзвін",
  Stock: "сток",
  Maneuver: "маневр",
  "Act lags Tar. P and I are small: there is error, little rate.":
    "Act відстає від Tar. P і I малі: помилка є, швидкості мало.",
  "Yaw P is small. Left stick — a slow turn.":
    "P рискання малий. Лівий стик — повільний розворот.",
  "P×0.2 and I are cut. Quiet in hover; {stick} stick — slow return (wool).":
    "P×0.2 і I зрізані. На висінні тихо; {stick} стиком — повільне повернення (вата).",
  "Act chases Tar. P is large — expect overshoot or ringing.":
    "Act ганяється за Tar. P великий — очікуйте переліт або дзвін.",
  "P is high. {Stick} stick will show overshoot or ringing.":
    "P завищений. {Stick} стиком покаже переліт або дзвін.",
  "Yaw stick is rate. Watch whether amber and cyan match on the lower plot.":
    "Стік рискання — це rate. Дивіться, чи жовта і синя на нижньому графіку збігаються.",
  "Watch whether cyan meets white after you release the stick.":
    "Дивіться, чи збігається блакитна лінія з білою після відпускання стика.",
  "Yaw is separate: I is smaller, D is often 0. Left stick is the reference — does rate catch the command.":
    "Yaw окремо: I менший, D часто 0. Лівий стік — еталон, чи rate ловить завдання.",
  "Typical P. {Stick} stick is the horizon-return reference.":
    "Типове P. {Stick} стиком — еталон повернення на горизонт.",
  "AGL height": "висота AGL",
  "takeoff ↑ {v} m/s": "зліт ↑ {v} м/с",
  Sitting: "лежить",
  "↑ {v} m/s": "↑ {v} м/с",
  "↓ {v} m/s": "↓ {v} м/с",
  Holding: "тримає",
  "Flight mode": "Режим польоту",
  Mode: "режим",
  "Mode {mode}": "режим {mode}",
  "Virtual Mode 2 sticks": "віртуальні стики Mode 2",
  "Left stick: yaw (left-right)": "Лівий стик: рискання (ліво-право)",
  "Left stick: throttle and yaw": "Лівий стик: газ і рискання",
  "Right stick: roll and pitch": "Правий стик: крен і тангаж",
  "Right stick: pitch (up-down)": "Правий стик: тангаж (вгору-вниз)",
  "Right stick: roll (left-right)": "Правий стик: крен (ліво-право)",
  Thr: "газ",
  "Thr−": "газ−",
  "Yaw−": "риск−",
  "Yaw+": "риск+",
  "Roll−": "крен−",
  "Roll+": "крен+",
  Log: "журнал",
  "No gains. Pick a regulator — sliders stay here and on the plot.":
    "Немає гейнів. Виберіть регулятор — слайдери залишаться тут і на графіку.",
  "Wool · P {p} I {i} D {d}": "вата · P {p} I {i} D {d}",
  "Stock · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}":
    "сток · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}",
  "Sharp · P {p} I {i} D {d}": "гостро · P {p} I {i} D {d}",
  "arm · {mode}": "arm · {mode}",
  off: "off",

  "lean angle": "нахил (lean)",
  "accel NE": "accel NE",
  "desired roll/pitch": "desired roll/pitch",
  "desired ad": "desired ad",
  "tar rate": "tar rate",
  "rate Act": "rate Act",
  "Pilot stick": "стік пілота",
  Navigation: "навігація",
  "NE position": "позиція NE",
  "D position": "позиція D",
  "NE velocity": "швидкість NE",
  "D velocity": "швидкість D",
  "D acceleration": "прискорення D",
  "angle → rate": "кут → rate",
  "rate → torque": "rate → момент",
  Motors: "мотори",
  command: "команда",
  "targets, not PID": "цілі, не PID",
  "not PID": "не PID",
  stick: "стік",
  "m · NED": "м · NED",
  "m · NED NE": "м · NED NE",
  "m · NED D+": "м · NED D+",
  "m/s · NED NE": "м/с · NED NE",
  "m/s · NED D+": "м/с · NED D+",
  "° · roll/pitch": "° · крен/тангаж",
  "m/s² · throttle": "м/с² · газ",
  "° · body": "° · тіло",
  "°/s · body": "°/с · тіло",
  "torque + throttle": "момент + газ",
  "accel → roll/pitch": "accel → крен/тангаж",
  "Pilot command, not a regulator. Where it enters depends on mode: desired attitude (Stabilize), climb rate (AltHold), lean (Loiter), angular rate (Acro).":
    "Команда з пульта, не регулятор. Куди вона входить — залежить від режиму: бажаний кут (attitude, Stabilize), швидкість набору (climb, AltHold), нахил (lean, Loiter), кутова швидкість (rate, Acro).",
  "Sets a target for PosControl (PSC); it does not run a PID. In Loiter the stick sets desired acceleration, then the outer loop. WP and Circle set a point or radius. If it drifts in place — look at PSC, not WP/LOIT.":
    "Задає ціль для PosControl (PSC), сам PID не крутить. У Loiter стік задає бажане прискорення, далі зовнішній контур. WP і Circle задають точку або радіус. Якщо «пливе» на місці — дивитись PSC, не WP/LOIT.",
  "P position regulator (PSC_NE_POS): horizontal distance error (North–East, metres) → desired horizontal velocity.":
    "P-регулятор позиції (position, PSC_NE_POS): помилка відстані на горизонті (North–East, метри) → бажана горизонтальна швидкість (velocity).",
  "P altitude regulator (PSC_D_POS): Down-axis error → desired vertical velocity (climb). D+ is down; AGL on the right is −D.":
    "P-регулятор висоти (position, PSC_D_POS): помилка по осі Down → бажана вертикальна швидкість (velocity, climb). D+ вниз; висота AGL справа — це −D.",
  "Horizontal velocity PID (PSC_NE_VEL): m/s error north/east → desired acceleration. There is no separate horizontal accel PID — the output becomes desired lean.":
    "PID горизонтальної швидкості (velocity, PSC_NE_VEL): помилка м/с на північ/схід → бажане прискорення (accel). Окремого PID прискорення по горизонту немає — вихід одразу стає бажаним нахилом (lean).",
  "Vertical velocity PID (PSC_D_VEL): m/s-down error → desired vertical acceleration.":
    "PID вертикальної швидкості (velocity, PSC_D_VEL): помилка м/с вниз → бажане вертикальне прискорення (accel).",
  "Not a regulator. Horizontal acceleration (m/s² in NED) becomes desired lean — roll and pitch. Coordinate frame changes here: earth → body.":
    "Не регулятор. Горизонтальне прискорення (accel, м/с² у NED) перетворюється на бажаний нахил (lean angle) — крен і тангаж. Тут система координат змінюється: земля → тіло.",
  "Vertical acceleration PID (PSC_D_ACC): m/s²-down error → throttle. This channel skips the angle loop — straight to the motors.":
    "PID вертикального прискорення (accel, PSC_D_ACC): помилка м/с² вниз → газ (throttle). Цей канал не проходить через контур кута — одразу в мотори.",
  "P attitude regulator (ATC_ANG): from angle error it computes how fast to rotate toward the target and sets the rate command for ATC_RAT. P only, three axes. On the map roll and pitch are aliased (gains write together); yaw is the same loop with its own parameters.":
    "P-регулятор кута (attitude, ATC_ANG): з помилки кута рахує, як швидко крутитись до цілі, і ставить завдання кутової швидкості (rate) для ATC_RAT. Лише P, три осі. На карті крен і тангаж зведені (гейни пишуться разом); рискання (yaw) — той самий контур, окремі параметри.",
  "Angular-rate PID (ATC_RAT): compares command to actual (°/s) and sends torque to the mixer. Three axes. Roll and pitch are aliased on the map; yaw is the same loop with its own P/I/D (smaller I, D defaults to 0).":
    "PID кутової швидкості (rate, ATC_RAT): порівнює завдання з фактом (°/с) і ставить мікшеру момент (torque), щоб крутитись саме так. Три осі. Крен і тангаж на карті зведені; рискання (yaw) — той самий контур, свої P/I/D (I менший, D за замовчуванням 0).",
  "Motor mixer (AP_Motors), not a PID. Rate-loop torque (ATC_RAT) and vertical-accel throttle (PSC_D_ACC) meet here.":
    "Мікшер моторів (AP_Motors), не PID. Сюди зходиться момент з контуру кутової швидкості (rate, ATC_RAT) і газ з вертикального прискорення (accel, PSC_D_ACC).",

  "want · angle, °": "хочемо · кут, °",
  "command · rate, °/s": "керуємо · rate, °/с",
  "want angle": "хочу кут",
  "stick = lean/accel": "стік = lean/accel",
  "stick = climb": "стік = climb",
  "stick = rate": "стік = rate",
  "XY target": "ціль XY",
  "D target": "ціль D",
  "desired Vxy": "бажана Vxy",
  "desired Vd": "бажаний Vd",
  throttle: "газ",
  torque: "момент",
  "not a regulator": "не регулятор",
  outer: "зовнішній",
  inner: "внутрішній",
  position: "позиція",
  velocity: "швидкість",
  acceleration: "прискорення",
  angle: "кут",
  actuator: "актуатор",
  "boundary · lean becomes desired angle": "межа · lean стає бажаним кутом",
  "stick {v}{unit}": "стик {v}{unit}",
  "target {v}°": "ціль {v}°",
  "{name} {v}°": "{name} {v}°",
  "tar {v}°/s": "tar {v}°/с",
  "rate {v}°/s": "rate {v}°/с",
  "AGL {v} m": "AGL {v} м",
  "{v}{unit}": "{v}{unit}",
  rate: "rate",
  P: "P",
  "P only": "лише P",
  AC_PID: "AC_PID",
  AC_PID_2D: "AC_PID_2D",
  AC_PID_Basic: "AC_PID_Basic",
  "PWM / DShot": "PWM / DShot",
  "{v} °/s": "{v} °/с",
  "{v} m": "{v} м",
  "Why the loops are separate": "Чому контури окремі",
  "all loops": "усі контури",
  "In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.":
    "У {mode} цей контур не працює: автопілот його зараз не крутить. Гейни можна дивитись, але на поведінку вони не вплинуть, поки режим його не замкне.",
  In: "Входить",
  Out: "Віддає",
  "Stock Copter cascade: PosControl (PSC, outer) holds where to be, Attitude Control (ATC, inner) holds the angle.":
    "Штатний каскад Copter: PosControl (PSC, зовнішній) тримає де бути, Attitude Control (ATC, внутрішній) тримає кут.",
  "Motors cannot “turn to 10°” — only thrust. Thrust difference makes torque. So the attitude regulator (ATC_ANG) does not spin motors: from angle error it computes how fast to rotate toward the target and sets a rate command for the next loop. The rate regulator does that job: °/s error → mixer torque.":
    "Мотори не вміють «повернутись на 10°» — лише тяга. Різниця тяг дає момент (torque). Тому регулятор кута (attitude, ATC_ANG) не крутить мотори: з помилки кута він рахує, як швидко треба крутитись до цілі, і ставить завдання кутової швидкості (rate, ATC_RAT) наступному контуру. Регулятор rate це завдання виконує: помилка °/с → момент у мікшер.",
  "The boundary is lean: horizontal acceleration becomes desired roll and pitch. Then ATC works in the body (° and °/s). Vertical skips angle: Down acceleration (PSC_D_ACC) goes straight to throttle. Yaw is the same two inner loops: angle and rate.":
    "Межа між ними — нахил (lean): горизонтальне прискорення стає бажаним креном і тангажем. Далі ATC працює в тілі (° і °/с). Вертикаль кут обходить: прискорення Down (accel, PSC_D_ACC) одразу йде в газ. Рискання (yaw) — ті самі два внутрішні контури: кут і кутова швидкість.",
  "There is no separate horizontal-acceleration PID. WP, Loiter and Circle set targets; they are not regulators. Not shown: Plane, CC2_, FHLD, FOLL, heli.":
    "Окремого PID горизонтального прискорення немає. WP, Loiter і Circle задають цілі, це не регулятори. Не показано: Plane, CC2_, FHLD, FOLL, heli.",
  "In {mode}, inactive blocks are not closed now.":
    "У {mode} неактивні блоки зараз не замкнені.",
  "All stock-cascade loops are visible now.": "Зараз видно всі контури штатного каскаду.",
  "this mode": "цьому режимі",

  "A loop because the output is compared to the command again.":
    "Контур тому, що вихід знову порівнюють із завданням.",
  "This block is not a PID. Below is a closed regulator loop (the same one on the map with P / I / D). Pick angle → rate or rate → torque to see live numbers.":
    "Цей блок не PID. Нижче — як виглядає замкнений контур регулятора (той самий, що на карті з літерами P / I / D). Виберіть кут → rate або rate → момент, щоб побачити живі числа.",
  "Closed PID loop": "Замкнений контур PID",
  "feedback — that is why it is a loop": "зворотний звʼязок (feedback) — тому це loop",
  want: "хочемо",
  error: "помилка",
  plant: "обʼєкт",
  "plant · motors / body": "plant · мотори / тіло",
  actual: "факт",
  none: "немає",
  "rate command": "завдання rate",
  "actual rate": "факт rate",
  "angle target": "ціль кута",
  "desired rate": "бажаний rate",
  setpoint: "завдання",
  output: "вихід",
  "(−1…+1 mixer)": "(−1…+1 мікшер)",
  "now {v}{mix}": "зараз {v}{mix}",
  "stick on the plot": "стік на графіку",
  "This is a simplification of AC_PID / AC_P. Firmware also has target and D filters (FLTT / FLTE / FLTD), integrator ceiling IMAX and slew limits (SMAX). On the wing, FF · r is added.":
    "Це спрощення AC_PID / AC_P. У прошивці ще фільтри цілі й D (FLTT / FLTE / FLTD), стеля інтегратора IMAX і обмеження slew (SMAX). На крилі додається FF · r.",
};
