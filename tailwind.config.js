/** @type {import('tailwindcss').Config} */
module.exports={
  content:["./src/01_head.html","./src/02_script_open.html","./src/99_tail.html","./src/10_words.js","./src/20_core.js","./src/30_battle.js","./src/35_room.js","./src/50_stats.js","./src/60_data.js"],
  theme:{extend:{}},
  plugins:[require("daisyui")],
  daisyui:{themes:["light"],styled:true,logs:false}
};
