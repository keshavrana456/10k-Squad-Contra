import { useEffect, useRef, useState } from "react";

const CW = 680;
const CH = 380;
const GRAVITY = 0.42;
const JUMP_FORCE = -10.2;
const PSPEED = 2.8;
const P = 2; // pixel unit
let dtS = 1; // delta-time scale, updated each frame

type Weapon = "M"|"S"|"L"|"F"|"R";
type Phase = "title"|"intro"|"play"|"bwarn"|"boss"|"clear"|"wclear"|"over"|"win";

function hit(ax:number,ay:number,aw:number,ah:number,bx:number,by:number,bw:number,bh:number){
  return ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by;
}

export default function Game(){
  const cv=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=cv.current!;
    const ctx=canvas.getContext("2d")!;

    //──── AUDIO ─────────────────────────────────────────────────────────────
    let AC:AudioContext|null=null;
    const ac=()=>{
      if(!AC)AC=new(window.AudioContext||(window as never as{webkitAudioContext:typeof AudioContext}).webkitAudioContext)();
      return AC;
    };
    const tone=(f:number,t:OscillatorType,d:number,v=0.2,fe?:number)=>{
      try{const c=ac(),o=c.createOscillator(),g=c.createGain();
        o.connect(g);g.connect(c.destination);o.type=t;o.frequency.value=f;
        if(fe!=null)o.frequency.linearRampToValueAtTime(fe,c.currentTime+d);
        g.gain.setValueAtTime(v,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+d);
        o.start();o.stop(c.currentTime+d);}catch(_){}
    };
    const noise=(d:number,cut=500,v=0.22)=>{
      try{const c=ac(),n=c.sampleRate*d,b=c.createBuffer(1,n,c.sampleRate);
        const dd=b.getChannelData(0);for(let i=0;i<n;i++)dd[i]=Math.random()*2-1;
        const s=c.createBufferSource();s.buffer=b;
        const f=c.createBiquadFilter();f.type="lowpass";f.frequency.value=cut;
        const g=c.createGain();g.gain.setValueAtTime(v,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+d);
        s.connect(f);f.connect(g);g.connect(c.destination);s.start();s.stop(c.currentTime+d);}catch(_){}
    };
    const sfxShoot=()=>tone(900,"square",0.06,0.1);
    const sfxJump=()=>tone(220,"sine",0.12,0.15,500);
    const sfxExp=()=>noise(0.3,380,0.28);
    const sfxBigExp=()=>noise(0.7,180,0.35);
    const sfxPickup=()=>{[261,329,392].forEach((f,i)=>setTimeout(()=>tone(f,"square",0.07,0.15),i*65));};
    const sfxDie=()=>tone(350,"square",0.18,0.15,70);

    let mBeat=0,mTimer=0,mOn=true;
    const ML=[392,440,523,587,523,440,392,349,392,440,523,659,523,440,392,349];
    const MB=[196,196,261,261,261,196,196,196,196,196,261,329,261,196,196,196];
    const tickM=(bpm:number)=>{
      const iv=(60/bpm/4)*1000;mTimer+=16.67;
      if(mTimer<iv)return;mTimer=0;if(!mOn)return;
      const i=mBeat%ML.length;
      tone(ML[i],"square",0.1,0.06);
      if(mBeat%2===0)tone(MB[i],"triangle",0.18,0.045);
      if(mBeat%4===0)noise(0.04,1400,0.035);
      if(mBeat%8===0||mBeat%8===4)noise(0.08,75,0.09);
      mBeat++;
    };

    //──── PARTICLES ─────────────────────────────────────────────────────────
    interface Par{x:number;y:number;vx:number;vy:number;life:number;ml:number;col:string;sz:number;}
    const pars:Par[]=[];
    const burst=(x:number,y:number,n:number,cols:string[],spd=3)=>{
      for(let i=0;i<n;i++){
        if(pars.length>=200)pars.shift();
        const a=Math.PI*2*i/n+Math.random()*0.5,s=spd*(0.5+Math.random());
        pars.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1.5,life:35+Math.random()*20,ml:55,col:cols[Math.floor(Math.random()*cols.length)],sz:2+Math.random()*3});
      }
    };

    //──── BULLETS ──────────────────────────────────────────────────────────
    interface Bul{x:number;y:number;vx:number;vy:number;pl:boolean;wp:Weapon;dmg:number;dead:boolean;pierce:number;sp?:number;sd?:number;}
    const buls:Bul[]=[];
    const spawnBul=(x:number,y:number,vx:number,vy:number,pl:boolean,wp:Weapon="M",pierce=0)=>{
      if(buls.length>=120)buls.shift();
      buls.push({x,y,vx,vy,pl,wp,dmg:wp==="L"?3:1,dead:false,pierce});
    };

    //──── PLATFORMS / LEVEL GEOMETRY ────────────────────────────────────────
    interface Plat{x:number;y:number;w:number;h:number;moving?:boolean;vx?:number;minX?:number;maxX?:number;}
    interface Bush{x:number;y:number;w:number;h:number;}   // hiding spot

    //──── PICKUPS ──────────────────────────────────────────────────────────
    interface Pick{x:number;y:number;vy:number;type:"S"|"L"|"F"|"R"|"B"|"1UP";timer:number;bounced:boolean;bob:number;dead:boolean;}
    const picks:Pick[]=[];
    const dropPick=(x:number,y:number,type:Pick["type"])=>picks.push({x,y,vy:-2.5,type,timer:450,bounced:false,bob:0,dead:false});

    //──── DRONES ───────────────────────────────────────────────────────────
    interface Drone{x:number;y:number;vx:number;wp:Weapon;dead:boolean;}
    const drones:Drone[]=[];
    let droneT=0;

    //──── ENEMIES (creatures) ───────────────────────────────────────────────
    type EType="blob"|"spider"|"bat"|"worm"|"crab"|"spitter"|"bug";
    interface Enemy{
      x:number;y:number;w:number;h:number;hp:number;maxHp:number;
      type:EType;dir:-1;                     // always face/move left
      hidden:boolean;emerging:boolean;        // hide in bush, emerge when near
      emergeTimer:number;spawnProtect:number;
      shootT:number;shootCD:number;
      animF:number;animT:number;
      dead:boolean;flashT:number;groundY:number;
      burstN:number;flameT:number;
    }
    const enemies:Enemy[]=[];

    const SPAWN_DISTANCE=280; // px - emerge when player this close

    function spawnEnemy(x:number,type:EType,groundY:number,hidden=true){
      if(enemies.length>=50)return;
      const big=type==="spider"||type==="spitter";
      enemies.push({
        x,y:groundY-(big?34:26),w:big?28:22,h:big?34:26,
        hp:type==="spider"||type==="crab"?2:type==="spitter"?3:1,
        maxHp:type==="spider"||type==="crab"?2:type==="spitter"?3:1,
        type,dir:-1,
        hidden,emerging:false,emergeTimer:0,spawnProtect:0,
        shootT:0,shootCD:type==="spider"?80:type==="spitter"?55:type==="bug"?45:70,
        animF:0,animT:0,
        dead:false,flashT:0,groundY,
        burstN:0,flameT:0,
      });
    }

    //──── LEVEL DATA ───────────────────────────────────────────────────────
    const GY=CH-48; // base ground y

    // Contra-style multi-level stage layout
    // Upper path ~100px above ground, lower dips, water section, bridges
    interface LevelDef{
      world:number;length:number;bpm:number;
      skyA:string;skyB:string;
      groundCol:string;groundLine:string;
      platCol:string;platTop:string;
      wallCol:string;
      spawns:{x:number;type:EType;groundY:number}[];
      plats:Plat[];
      bushes:Bush[];  // enemy hiding spots (visual + triggers)
      waterX?:number;waterW?:number;
    }

    function mkLvl1():LevelDef{
      const upper=GY-90;
      const spawns:{x:number;type:EType;groundY:number}[]=[
        {x:450, type:"blob",   groundY:GY},
        {x:650, type:"blob",   groundY:GY},
        {x:850, type:"worm",   groundY:GY},
        {x:780, type:"blob",   groundY:upper+90},
        {x:1000,type:"spider", groundY:GY},
        {x:1150,type:"bat",    groundY:GY},
        {x:1300,type:"worm",   groundY:GY},
        {x:1450,type:"crab",   groundY:upper+90},
        {x:1600,type:"blob",   groundY:GY},
        {x:1750,type:"spitter",groundY:GY},
        {x:1900,type:"bug",    groundY:GY},
        {x:2050,type:"spider", groundY:GY},
        {x:2250,type:"blob",   groundY:GY},
        {x:2450,type:"bat",    groundY:GY},
        {x:2650,type:"worm",   groundY:GY},
        {x:2850,type:"crab",   groundY:upper+90},
        {x:3050,type:"spitter",groundY:GY},
        {x:3250,type:"blob",   groundY:GY},
        {x:3450,type:"spider", groundY:GY},
        {x:3650,type:"bat",    groundY:GY},
        {x:3850,type:"worm",   groundY:GY},
        {x:4050,type:"crab",   groundY:GY},
        {x:4250,type:"spitter",groundY:GY},
        {x:4450,type:"blob",   groundY:GY},
        {x:4650,type:"spider", groundY:upper+90},
        {x:4850,type:"bug",    groundY:GY},
        {x:5050,type:"bat",    groundY:GY},
        {x:5250,type:"worm",   groundY:GY},
        {x:5500,type:"crab",   groundY:GY},
        {x:5700,type:"spitter",groundY:GY},
        {x:5900,type:"blob",   groundY:GY},
        {x:6100,type:"spider", groundY:GY},
        {x:6300,type:"bat",    groundY:upper+90},
        {x:6500,type:"worm",   groundY:GY},
        {x:6700,type:"crab",   groundY:GY},
        {x:6900,type:"spitter",groundY:GY},
        {x:7100,type:"bug",    groundY:GY},
        {x:7300,type:"blob",   groundY:GY},
        {x:7500,type:"spider", groundY:GY},
      ];
      const plats:Plat[]=[
        {x:300, y:GY-90,w:160,h:12},{x:510,y:GY-90,w:130,h:12},{x:690,y:GY-90,w:140,h:12},
        {x:880, y:GY-90,w:110,h:12},{x:1040,y:GY-90,w:130,h:12},{x:1220,y:GY-90,w:120,h:12},
        {x:1390,y:GY-90,w:140,h:12},{x:1590,y:GY-90,w:110,h:12},{x:1760,y:GY-90,w:130,h:12},
        {x:400, y:GY-50,w:80,h:12},{x:640,y:GY-55,w:70,h:12},{x:1380,y:GY-55,w:80,h:12},
        {x:2000,y:GY-90,w:140,h:12},{x:2200,y:GY-90,w:130,h:12},{x:2400,y:GY-90,w:120,h:12},
        {x:2600,y:GY-50,w:90,h:12},{x:2800,y:GY-90,w:150,h:12},{x:3000,y:GY-90,w:130,h:12},
        {x:3200,y:GY-90,w:120,h:12},{x:3400,y:GY-90,w:140,h:12},{x:3600,y:GY-90,w:110,h:12},
        {x:3800,y:GY-60,w:90,h:12},{x:4000,y:GY-90,w:130,h:12},{x:4200,y:GY-90,w:120,h:12},
        {x:4400,y:GY-90,w:140,h:12},{x:4600,y:GY-90,w:110,h:12},{x:4800,y:GY-55,w:80,h:12},
        {x:5000,y:GY-90,w:130,h:12},{x:5200,y:GY-90,w:120,h:12,moving:true,vx:1.5,minX:5180,maxX:5400},
        {x:5450,y:GY-90,w:140,h:12},{x:5650,y:GY-90,w:110,h:12},{x:5850,y:GY-60,w:90,h:12},
        {x:6050,y:GY-90,w:130,h:12},{x:6250,y:GY-90,w:120,h:12},{x:6450,y:GY-90,w:140,h:12},
        {x:6650,y:GY-90,w:110,h:12},{x:6850,y:GY-90,w:130,h:12},{x:7050,y:GY-55,w:80,h:12},
        {x:7250,y:GY-90,w:120,h:12,moving:true,vx:-1.5,minX:7220,maxX:7450},{x:7500,y:GY-90,w:140,h:12},
      ];
      const bushes:Bush[]=[
        {x:430,y:GY-30,w:70,h:30},{x:630,y:GY-30,w:60,h:30},{x:830,y:GY-30,w:65,h:30},
        {x:1580,y:GY-30,w:70,h:30},{x:1880,y:GY-30,w:65,h:30},{x:2230,y:GY-30,w:70,h:30},
        {x:3000,y:GY-30,w:60,h:30},{x:3200,y:GY-30,w:70,h:30},{x:4000,y:GY-30,w:65,h:30},
        {x:4500,y:GY-30,w:70,h:30},{x:5200,y:GY-30,w:60,h:30},{x:5900,y:GY-30,w:70,h:30},
        {x:6500,y:GY-30,w:65,h:30},{x:7000,y:GY-30,w:70,h:30},{x:7400,y:GY-30,w:60,h:30},
      ];
      return{world:1,length:8200,bpm:124,skyA:"#0c1a08",skyB:"#1a3010",groundCol:"#3d2b1a",groundLine:"#2d5a14",platCol:"#5a3a10",platTop:"#8a6020",wallCol:"#4a3808",spawns,plats,bushes,waterX:2050,waterW:300};
    }

    function mkLvl2():LevelDef{
      const spawns:{x:number;type:EType;groundY:number}[]=[
        {x:500, type:"blob",   groundY:GY},{x:700, type:"spider", groundY:GY},
        {x:900, type:"spitter",groundY:GY},{x:1100,type:"bug",    groundY:GY},
        {x:1300,type:"crab",   groundY:GY},{x:1500,type:"blob",   groundY:GY},
        {x:1700,type:"worm",   groundY:GY},{x:1900,type:"spider", groundY:GY},
        {x:2100,type:"bat",    groundY:GY},{x:2300,type:"spitter",groundY:GY},
        {x:2500,type:"blob",   groundY:GY},{x:2700,type:"crab",   groundY:GY},
        {x:2900,type:"spider", groundY:GY},{x:3100,type:"blob",   groundY:GY},
        {x:3300,type:"worm",   groundY:GY},{x:3500,type:"spitter",groundY:GY},
        {x:3700,type:"bat",    groundY:GY},{x:3900,type:"bug",    groundY:GY},
        {x:4100,type:"crab",   groundY:GY},{x:4300,type:"spider", groundY:GY},
        {x:4500,type:"blob",   groundY:GY},{x:4700,type:"spitter",groundY:GY},
        {x:4900,type:"worm",   groundY:GY},{x:5100,type:"crab",   groundY:GY},
        {x:5300,type:"bat",    groundY:GY},{x:5500,type:"spider", groundY:GY},
        {x:5700,type:"blob",   groundY:GY},{x:5900,type:"spitter",groundY:GY},
        {x:6100,type:"worm",   groundY:GY},{x:6300,type:"crab",   groundY:GY},
        {x:6500,type:"spider", groundY:GY},{x:6700,type:"bat",    groundY:GY},
        {x:6900,type:"blob",   groundY:GY},{x:7100,type:"spitter",groundY:GY},
        {x:7300,type:"spider", groundY:GY},{x:7500,type:"crab",   groundY:GY},
      ];
      const plats:Plat[]=[
        {x:400, y:GY-90,w:140,h:12,moving:true,vx:1.5,minX:380,maxX:580},
        {x:650, y:GY-80,w:120,h:12},{x:850,y:GY-90,w:130,h:12},
        {x:1050,y:GY-70,w:100,h:12,moving:true,vx:-1.5,minX:1030,maxX:1250},
        {x:1300,y:GY-90,w:130,h:12},{x:1550,y:GY-80,w:110,h:12},{x:1780,y:GY-90,w:130,h:12},
        {x:2050,y:GY-80,w:100,h:12,moving:true,vx:1.5,minX:2030,maxX:2250},
        {x:2350,y:GY-90,w:120,h:12},{x:2600,y:GY-80,w:110,h:12},{x:2850,y:GY-90,w:130,h:12},
        {x:3100,y:GY-80,w:100,h:12},{x:3350,y:GY-90,w:120,h:12},{x:3600,y:GY-80,w:110,h:12},
        {x:3850,y:GY-90,w:130,h:12,moving:true,vx:1.5,minX:3820,maxX:4050},
        {x:4200,y:GY-80,w:110,h:12},{x:4450,y:GY-90,w:130,h:12},{x:4700,y:GY-80,w:100,h:12},
        {x:4950,y:GY-90,w:120,h:12},{x:5200,y:GY-80,w:110,h:12,moving:true,vx:-1.5,minX:5180,maxX:5400},
        {x:5500,y:GY-90,w:130,h:12},{x:5750,y:GY-80,w:110,h:12},{x:6000,y:GY-90,w:120,h:12},
        {x:6250,y:GY-80,w:100,h:12},{x:6500,y:GY-90,w:130,h:12},{x:6750,y:GY-80,w:110,h:12},
        {x:7000,y:GY-90,w:120,h:12},{x:7250,y:GY-80,w:100,h:12,moving:true,vx:1.5,minX:7220,maxX:7450},
        {x:7550,y:GY-90,w:130,h:12},
      ];
      return{world:2,length:8200,bpm:140,skyA:"#050510",skyB:"#0d0d22",groundCol:"#374151",groundLine:"#6b7280",platCol:"#4b5563",platTop:"#9ca3af",wallCol:"#1f2937",spawns,plats,bushes:[]};
    }

    function mkLvl3():LevelDef{
      const spawns:{x:number;type:EType;groundY:number}[]=[
        {x:450, type:"spider", groundY:GY},{x:650, type:"spitter",groundY:GY},
        {x:850, type:"crab",   groundY:GY},{x:1050,type:"blob",   groundY:GY},
        {x:1250,type:"bug",    groundY:GY},{x:1450,type:"worm",   groundY:GY},
        {x:1650,type:"bat",    groundY:GY},{x:1850,type:"spider", groundY:GY},
        {x:2050,type:"spitter",groundY:GY},{x:2250,type:"crab",   groundY:GY},
        {x:2450,type:"blob",   groundY:GY},{x:2650,type:"spider", groundY:GY},
        {x:2850,type:"spitter",groundY:GY},{x:3050,type:"crab",   groundY:GY},
        {x:3250,type:"spider", groundY:GY},{x:3450,type:"bat",    groundY:GY},
        {x:3650,type:"worm",   groundY:GY},{x:3850,type:"spitter",groundY:GY},
        {x:4050,type:"crab",   groundY:GY},{x:4250,type:"spider", groundY:GY},
        {x:4450,type:"blob",   groundY:GY},{x:4650,type:"bug",    groundY:GY},
        {x:4850,type:"bat",    groundY:GY},{x:5050,type:"spitter",groundY:GY},
        {x:5250,type:"crab",   groundY:GY},{x:5450,type:"spider", groundY:GY},
        {x:5650,type:"worm",   groundY:GY},{x:5850,type:"blob",   groundY:GY},
        {x:6050,type:"spitter",groundY:GY},{x:6250,type:"crab",   groundY:GY},
        {x:6450,type:"spider", groundY:GY},{x:6650,type:"bat",    groundY:GY},
        {x:6850,type:"blob",   groundY:GY},{x:7050,type:"spitter",groundY:GY},
        {x:7250,type:"crab",   groundY:GY},{x:7450,type:"spider", groundY:GY},
        {x:7650,type:"bug",    groundY:GY},{x:7850,type:"worm",   groundY:GY},
        {x:8050,type:"spitter",groundY:GY},{x:8250,type:"crab",   groundY:GY},
      ];
      const plats:Plat[]=[
        {x:350, y:GY-85,w:120,h:12},{x:550,y:GY-110,w:100,h:12},{x:730,y:GY-85,w:130,h:12},
        {x:980, y:GY-100,w:110,h:12},{x:1180,y:GY-85,w:130,h:12},
        {x:1430,y:GY-100,w:100,h:12,moving:true,vx:1.5,minX:1400,maxX:1650},
        {x:1680,y:GY-85,w:120,h:12},{x:1930,y:GY-100,w:110,h:12},{x:2180,y:GY-85,w:130,h:12},
        {x:2430,y:GY-100,w:120,h:12},{x:2680,y:GY-85,w:130,h:12},
        {x:2930,y:GY-100,w:110,h:12,moving:true,vx:-1.5,minX:2900,maxX:3150},
        {x:3180,y:GY-85,w:120,h:12},{x:3430,y:GY-100,w:130,h:12},{x:3680,y:GY-85,w:120,h:12},
        {x:3930,y:GY-100,w:110,h:12},{x:4180,y:GY-85,w:130,h:12},{x:4430,y:GY-100,w:120,h:12},
        {x:4680,y:GY-85,w:130,h:12,moving:true,vx:1.5,minX:4650,maxX:4900},
        {x:4930,y:GY-100,w:110,h:12},{x:5180,y:GY-85,w:130,h:12},{x:5430,y:GY-100,w:120,h:12},
        {x:5680,y:GY-85,w:130,h:12},{x:5930,y:GY-100,w:110,h:12},
        {x:6180,y:GY-85,w:130,h:12,moving:true,vx:-1.5,minX:6150,maxX:6400},
        {x:6430,y:GY-100,w:120,h:12},{x:6680,y:GY-85,w:130,h:12},{x:6930,y:GY-100,w:110,h:12},
        {x:7180,y:GY-85,w:130,h:12},{x:7430,y:GY-100,w:120,h:12},{x:7680,y:GY-85,w:130,h:12},
        {x:7930,y:GY-100,w:110,h:12},{x:8180,y:GY-85,w:130,h:12},
      ];
      return{world:3,length:9000,bpm:155,skyA:"#0a0010",skyB:"#1a0028",groundCol:"#4a1a3a",groundLine:"#7c3aed",platCol:"#5a1a4a",platTop:"#a855f7",wallCol:"#2d0040",spawns,plats,bushes:[]};
    }

    const levels=[mkLvl1(),mkLvl2(),mkLvl3()];

    //──── BOSS ─────────────────────────────────────────────────────────────
    interface BossEye{x:number;y:number;hp:number;dead:boolean;regen:number;regenC:number;}
    interface Boss{
      x:number;y:number;w:number;h:number;hp:number;maxHp:number;
      phase:number;timer:number;state:"enter"|"fight"|"dead";
      world:number;dead:boolean;flashT:number;
      eyes?:BossEye[];coreExp:boolean;
      deployT:number;atkT:number;laserOn:boolean;laserT:number;
    }
    let boss:Boss|null=null;

    function spawnBoss(world:number){
      boss={
        x:g.camX+CW+60,
        y:world===1?GY-100:world===2?CH/2-70:CH/2-90,
        w:world===1?110:world===2?90:180,
        h:world===1?95:world===2?130:130,
        hp:world===1?12:world===2?16:20,maxHp:world===1?12:world===2?16:20,
        phase:0,timer:0,state:"enter",world,dead:false,flashT:0,
        coreExp:world!==2,deployT:world===1?600:0,atkT:0,
        laserOn:false,laserT:0,
        eyes:world===2?[
          {x:0,y:-70,hp:2,dead:false,regen:0,regenC:0},
          {x:0,y:70, hp:2,dead:false,regen:0,regenC:0},
          {x:-70,y:0,hp:2,dead:false,regen:0,regenC:0},
          {x:70,y:0, hp:2,dead:false,regen:0,regenC:0},
        ]:undefined,
      };
    }

    //──── PLAYER ───────────────────────────────────────────────────────────
    const pl={
      x:100,y:GY,vx:0,vy:0,
      w:18,h:28,onGrd:false,
      prone:false,dir:1 as 1|-1,
      aimUp:false,aimDiag:false,
      wp:"M" as Weapon,
      lives:3,score:0,hi:0,
      shootT:0,animF:0,animT:0,
      dead:false,deadT:0,inv:0,
      barrier:0,rapid:0,bombs:0,flash:0,
      jumpConsumed:false,
    };

    //──── GAME STATE ────────────────────────────────────────────────────────
    const g={
      phase:"title" as Phase,
      world:0,camX:0,
      shakeX:0,shakeY:0,shakeDur:0,
      flashA:0,warnT:0,introT:0,clearT:0,wclearT:0,
      overT:0,contCount:9,contT:0,
      winT:0,winParX:-40,
      spawned:[] as boolean[],
    };

    //──── INPUT ─────────────────────────────────────────────────────────────
    const K:Record<string,boolean>={};
    let paused=false;
    const tc={active:false,jx:0,jy:0,shoot:false,jump:false,bomb:false,jumpNow:false};

    const kd=(e:KeyboardEvent)=>{
      const prev=K[e.key];K[e.key]=true;
      if((e.key==="p"||e.key==="P")&&(g.phase==="play"||g.phase==="boss"))paused=!paused;
      if(!prev&&(e.key===" "||e.key==="Enter")){
        if(g.phase==="title")startGame();
        else if(g.phase==="over"){g.contCount>0?continueGame():fullReset();}
      }
      e.preventDefault();
    };
    const ku=(e:KeyboardEvent)=>{K[e.key]=false;e.preventDefault();};
    document.addEventListener("keydown",kd);
    document.addEventListener("keyup",ku);

    const JX=90,JY=CH-80,JR=62;
    const SBX=CW-48,SBY=CH-85;
    const JBX=CW-108,JBY=CH-138;
    const BBX=CW-168,BBY=CH-85;
    const BR=34;
    const tp=(t:Touch)=>{const r=canvas.getBoundingClientRect();return{x:(t.clientX-r.left)*(CW/r.width),y:(t.clientY-r.top)*(CH/r.height)};};
    canvas.addEventListener("touchstart",e=>{
      e.preventDefault();
      for(const t of Array.from(e.changedTouches)){
        const{x,y}=tp(t);
        if(g.phase==="title"||g.phase==="over"){startGame();return;}
        if(Math.hypot(x-JX,y-JY)<JR+22){tc.active=true;tc.jx=x-JX;tc.jy=y-JY;}
        if(Math.hypot(x-SBX,y-SBY)<BR+10)tc.shoot=true;
        if(Math.hypot(x-JBX,y-JBY)<BR+10){tc.jump=true;tc.jumpNow=true;}
        if(Math.hypot(x-BBX,y-BBY)<BR+10)tc.bomb=true;
      }
    },{passive:false});
    canvas.addEventListener("touchmove",e=>{
      e.preventDefault();
      if(!tc.active)return;
      for(const t of Array.from(e.changedTouches)){
        const{x,y}=tp(t);
        tc.jx=Math.max(-JR,Math.min(JR,x-JX));
        tc.jy=Math.max(-JR,Math.min(JR,y-JY));
      }
    },{passive:false});
    canvas.addEventListener("touchend",e=>{
      e.preventDefault();
      for(const t of Array.from(e.changedTouches)){
        const{x,y}=tp(t);
        if(Math.hypot(x-JX,y-JY)<JR+28){tc.active=false;tc.jx=0;tc.jy=0;}
        if(Math.hypot(x-SBX,y-SBY)<BR+14)tc.shoot=false;
        if(Math.hypot(x-JBX,y-JBY)<BR+14)tc.jump=false;
        if(Math.hypot(x-BBX,y-BBY)<BR+14)tc.bomb=false;
      }
    },{passive:false});

    //──── DRAW HELPERS ──────────────────────────────────────────────────────
    // px-block helper: draw a P×P rect at grid coords
    const b=(x:number,y:number,w:number,h:number)=>ctx.fillRect(x*P,y*P,w*P,h*P);

    // Side-view parrot (origin = feet center)
    function drawParrot(state:"stand"|"run"|"jump"|"prone"|"dead"|"up"|"diag",frame:number,shoot:boolean){
      const PK="#ff69b4",DP="#d6348a",LP="#ffb6c1",PU="#7c3aed",LPU="#a78bfa";
      const W="#fff",R="#dc2626",SK="#fca5a5",GY2="#6b7280",DGY="#374151";
      ctx.save();

      if(state==="prone"){
        // Fully flat / prone — lying on the floor, gun forward
        const GN="#1a2e1a",GNL="#2d4a2d",GND="#0f1f0f";
        const TN="#4a3728",TNL="#6b4f3a";
        // Tail feathers (behind, pointing left)
        ctx.fillStyle=DP;b(-13,-4,4,2);b(-14,-2,4,2);b(-12,-1,3,2);b(-11,-5,3,2);
        ctx.fillStyle=PK;b(-10,-3,3,3);
        // Main body — flat, horizontal, hugging floor
        ctx.fillStyle=PK;b(-8,-6,17,7);b(-9,-4,1,5);b(9,-4,1,5);
        ctx.fillStyle=LP;b(-7,-5,14,5);
        ctx.fillStyle="#fce7f3";b(-5,-4,9,3); // belly sheen
        // Back wing resting on ground
        ctx.fillStyle=DP;b(-6,-7,6,3);b(-4,-8,4,2);
        // Spiky crest — jutting up from head
        ctx.fillStyle=DP;b(7,-14,2,5);b(9,-16,2,6);b(11,-14,2,5);b(13,-12,2,4);
        ctx.fillStyle="#f472b6";b(8,-13,2,4);b(10,-15,2,5);b(12,-12,2,3);
        // Head (right end of body)
        ctx.fillStyle=PK;b(6,-9,13,8);b(5,-7,1,5);b(19,-7,1,4);b(7,-10,10,2);
        ctx.fillStyle=LP;b(7,-8,8,5);
        ctx.fillStyle="#fce7f3";b(8,-7,5,3);
        // Big white eye
        ctx.fillStyle=W;b(12,-9,5,5);b(11,-8,1,3);b(17,-8,1,3);
        ctx.fillStyle=R;b(13,-8,3,3);
        ctx.fillStyle="#000";b(14,-7,2,2);
        ctx.fillStyle=W;b(13,-9,2,1);
        // Hooked beak pointing right/forward
        ctx.fillStyle=PU;b(19,-8,5,3);b(21,-6,4,2);b(20,-5,3,2);
        ctx.fillStyle=LPU;b(19,-8,5,1);b(21,-6,3,1);
        ctx.fillStyle="#5b21b6";b(21,-5,2,1);
        // Front wing reaching to hold gun
        ctx.fillStyle=DP;b(2,-5,7,4);ctx.fillStyle=PK;b(3,-4,5,3);
        // Legs stretched back (tucked under body)
        ctx.fillStyle=SK;b(-5,0,4,2);b(-1,0,4,2);
        ctx.fillStyle="#c084fc";b(-6,1,3,1);b(-2,1,3,1); // claws
        // ── AK47 lying flat, barrel extends far right ──
        // Stock (rear, behind body)
        ctx.fillStyle=TN;b(-2,-4,5,4);b(-3,-3,2,4);b(-1,-1,4,2);
        ctx.fillStyle=TNL;b(-2,-4,5,1);
        // Receiver
        ctx.fillStyle=GN;b(3,-5,12,4);
        ctx.fillStyle=GNL;b(3,-5,12,1);
        ctx.fillStyle=GND;b(3,-2,12,1);
        // Pistol grip (goes down into floor area)
        ctx.fillStyle=TN;b(7,-1,3,4);ctx.fillStyle=TNL;b(8,-1,2,3);
        // Curved AK magazine (pointing down)
        ctx.fillStyle=GN;b(8,1,5,5);b(9,5,4,2);b(7,2,2,4);
        ctx.fillStyle=GNL;b(9,1,3,4);ctx.fillStyle=GND;b(7,1,1,5);b(12,2,1,4);
        // Front handguard
        ctx.fillStyle=GND;b(14,-5,5,4);ctx.fillStyle=GN;b(14,-4,5,3);ctx.fillStyle=GNL;b(15,-4,3,2);
        // Gas tube
        ctx.fillStyle=GND;b(10,-6,11,2);ctx.fillStyle=GN;b(11,-6,9,1);
        // Long barrel extends far forward
        ctx.fillStyle=GN;b(19,-5,16,2);ctx.fillStyle=GNL;b(19,-5,16,1);
        ctx.fillStyle=GND;b(19,-4,16,1);
        // Muzzle brake
        ctx.fillStyle=GND;b(34,-6,4,5);ctx.fillStyle=GN;b(35,-5,2,4);
        // Muzzle flash
        if(shoot){
          ctx.fillStyle="#facc15";b(37,-7,6,7);
          ctx.fillStyle="#fde68a";b(38,-6,5,5);
          ctx.fillStyle="#fff";b(39,-5,3,3);
        }
      } else if(state==="dead"){
        ctx.save();ctx.rotate(frame*0.18);
        ctx.fillStyle=DP;b(-5,-5,10,10);
        ctx.fillStyle=PK;b(-3,-3,6,6);
        ctx.fillStyle=PU;b(2,-1,3,2);
        ctx.restore();
      } else if(state==="jump"){
        // Wings spread in jump
        ctx.fillStyle=DP; // wings
        b(-5,-8,5,3);b(-6,-10,4,2);
        b(9,-8,5,3);b(10,-10,4,2);
        // crest
        ctx.fillStyle=DP;b(1,-16,2,3);b(3,-18,2,4);b(5,-19,2,5);b(7,-17,2,3);b(9,-15,2,2);
        ctx.fillStyle=PK;b(2,-14,8,8);b(1,-12,1,5);b(10,-12,1,5);
        ctx.fillStyle=LP;b(3,-13,5,5);
        ctx.fillStyle=W;b(7,-13,3,3);ctx.fillStyle=R;b(8,-12,2,2);ctx.fillStyle="#000";b(8,-12,1,1);ctx.fillStyle=W;b(8,-13,1,1);
        ctx.fillStyle=PU;b(10,-11,3,2);b(10,-10,2,1);ctx.fillStyle=LPU;b(10,-11,3,1);
        // body
        ctx.fillStyle=DP;b(-1,-2,4,3); // tail
        ctx.fillStyle=PK;b(1,-7,11,9);b(0,-5,1,5);b(12,-5,1,5);
        ctx.fillStyle=LP;b(2,-6,8,7);
        // gun
        ctx.fillStyle=DP;b(8,-5,5,3);ctx.fillStyle=DGY;b(12,-5,8,3);ctx.fillStyle=GY2;b(12,-5,8,1);
        if(shoot){ctx.fillStyle="#facc15";b(20,-6,3,5);}
        // legs tucked
        ctx.fillStyle=SK;b(3,1,3,3);b(7,1,3,3);
      } else if(state==="up"||state==="diag"){
        // Body same as stand/run
        _parrotBody(frame,PK,DP,LP,PU,LPU,W,R,SK,GY2,DGY,state==="run"?frame:0);
        // override gun to point up or diagonal
        if(state==="up"){
          ctx.fillStyle=DP;b(7,-14,3,5);
          ctx.fillStyle=DGY;b(7,-21,3,8);ctx.fillStyle=GY2;b(7,-21,1,8);
          if(shoot){ctx.fillStyle="#facc15";b(6,-23,5,3);}
        } else {
          ctx.fillStyle=DP;b(8,-12,4,3);
          ctx.fillStyle=DGY;b(11,-17,5,2);b(13,-15,5,2);ctx.fillStyle=GY2;b(11,-17,5,1);
          if(shoot){ctx.fillStyle="#facc15";b(17,-18,4,4);}
        }
      } else {
        _parrotBody(frame,PK,DP,LP,PU,LPU,W,R,SK,GY2,DGY,state==="run"?frame:0);
      }
      ctx.restore();
    }

    function _parrotBody(frame:number,PK:string,DP:string,LP:string,PU:string,LPU:string,W:string,R:string,SK:string,GY2:string,DGY:string,runF:number){
      const lf=runF%8<4?1:-1;
      const GN="#1a2e1a",GNL="#2d4a2d",GND="#0f1f0f"; // gun metal greens
      const TN="#4a3728",TNL="#6b4f3a",TND="#2e1f14"; // tactical tan/stock
      // animated legs with claws
      ctx.fillStyle=SK;
      b(3,1,3,6+lf*2);b(7,1,3,6-lf*2);
      b(1,7+lf*2,5,2);b(5,7-lf*2,5,2);
      // claws
      ctx.fillStyle="#c084fc";
      b(1,9+lf*2,2,2);b(3,9+lf*2,2,2);b(5,9+lf*2,2,2);
      b(5,9-lf*2,2,2);b(7,9-lf*2,2,2);b(9,9-lf*2,2,2);
      // layered tail feathers
      ctx.fillStyle=DP;b(-5,-2,4,2);b(-6,0,4,2);b(-5,2,4,2);b(-4,-4,3,2);b(-3,-6,3,2);
      ctx.fillStyle=PK;b(-4,-1,3,3);
      // body — larger, rounder
      ctx.fillStyle=PK;b(0,-9,14,11);b(-1,-7,1,8);b(14,-7,1,8);
      ctx.fillStyle=LP;b(1,-8,10,9);
      ctx.fillStyle=DP;b(1,-9,2,2);b(11,-9,2,2); // shoulder definition
      // back wing with feather detail
      ctx.fillStyle=DP;b(-2,-7,5,6);b(-3,-5,4,3);b(-2,-9,3,3);
      ctx.fillStyle=PK;b(-1,-6,3,4);
      // belly feather sheen
      ctx.fillStyle=LP;b(3,-4,7,4);
      ctx.fillStyle="#fce7f3";b(4,-3,5,2);
      // tall spiky crest
      ctx.fillStyle=DP;b(0,-22,2,5);b(2,-26,2,6);b(4,-28,2,7);b(6,-30,2,8);b(8,-28,2,6);b(10,-25,2,5);b(12,-22,2,4);
      ctx.fillStyle="#f472b6";b(1,-21,2,4);b(3,-24,2,5);b(5,-26,2,6);b(7,-25,2,5);b(9,-22,2,4);
      // head — bigger with cheek puff
      ctx.fillStyle=PK;b(1,-19,13,11);b(0,-17,1,7);b(14,-17,1,6);b(2,-20,10,2);
      ctx.fillStyle=LP;b(2,-18,8,8);
      ctx.fillStyle="#fce7f3";b(3,-16,5,5); // cheek puff
      // big white eye with red iris
      ctx.fillStyle=W;b(7,-18,6,6);b(6,-17,1,4);b(13,-17,1,3);
      ctx.fillStyle=R;b(9,-17,3,4);
      ctx.fillStyle="#000";b(10,-16,2,2);
      ctx.fillStyle=W;b(9,-17,2,1); // eye glint
      // purple beak — hooked parrot beak
      ctx.fillStyle=PU;b(13,-16,5,3);b(15,-14,4,2);b(14,-13,3,2);
      ctx.fillStyle=LPU;b(13,-16,5,1);b(15,-14,3,1);
      ctx.fillStyle="#5b21b6";b(14,-13,2,1); // beak hook
      // nostril
      ctx.fillStyle="#6d28d9";b(14,-15,2,1);
      // === AK47/SCAR-style assault rifle ===
      // Front grip wing
      ctx.fillStyle=DP;b(8,-7,6,5);ctx.fillStyle=PK;b(9,-6,4,3);
      // Stock (rear of gun behind body)
      ctx.fillStyle=TN;b(3,-6,6,4);b(2,-5,2,5);b(4,-3,4,3);
      ctx.fillStyle=TNL;b(3,-6,5,2);
      ctx.fillStyle=TND;b(3,-2,4,2); // cheekrest
      // Receiver body
      ctx.fillStyle=GN;b(8,-8,10,5);
      ctx.fillStyle=GNL;b(8,-8,10,2); // top rail
      ctx.fillStyle=GND;b(8,-4,10,1); // bottom
      // Charging handle
      ctx.fillStyle=GY2;b(15,-9,2,2);
      // Trigger guard + grip
      ctx.fillStyle=GND;b(13,-4,3,2);b(12,-3,5,2); // trigger guard
      ctx.fillStyle=TN;b(13,-3,3,5); // pistol grip
      ctx.fillStyle=TNL;b(14,-3,2,3);
      // Curved magazine (AK style)
      ctx.fillStyle=GN;b(14,0,5,7);b(15,6,4,3);b(13,1,2,5);
      ctx.fillStyle=GNL;b(15,0,3,5);
      ctx.fillStyle=GND;b(13,0,1,6);b(18,1,1,5);
      // Front handguard
      ctx.fillStyle=GND;b(18,-7,5,5);
      ctx.fillStyle=GN;b(18,-6,5,3);
      ctx.fillStyle=GNL;b(19,-6,3,2);
      // Long barrel
      ctx.fillStyle=GN;b(22,-7,12,3);
      ctx.fillStyle=GNL;b(22,-7,12,1);
      ctx.fillStyle=GND;b(22,-5,12,1);
      // Gas tube above barrel
      ctx.fillStyle=GND;b(18,-9,11,2);
      ctx.fillStyle=GN;b(19,-9,9,1);
      // Muzzle brake / compensator
      ctx.fillStyle=GND;b(33,-8,4,5);b(34,-9,3,7);
      ctx.fillStyle=GN;b(34,-8,2,5);
      // Muzzle flash
      if(Math.abs(pl.flash)>0&&frame%2===0){
        ctx.fillStyle="#facc15";b(36,-10,6,9);
        ctx.fillStyle="#fde68a";b(37,-9,4,7);
        ctx.fillStyle="#fff";b(38,-8,2,5);
      }
    }

    // Creature enemy sprites
    function drawEnemy(e:Enemy,sx:number){
      ctx.save();
      ctx.translate(sx,e.y+e.h);
      if(e.dir>0)ctx.scale(-1,1); // always face left (dir=-1), flip ctx for right
      if(e.flashT>0)ctx.filter="brightness(8)";

      // Enemies always visible

      switch(e.type){
        case "blob":{
          // Green slimy blob
          const bob=Math.sin(e.animF*0.5)*2;
          ctx.fillStyle="#16a34a";
          b(-8,-14+bob,16,14);b(-6,-16+bob,12,4);b(-10,-12+bob,2,6);b(8,-12+bob,2,6);
          ctx.fillStyle="#22c55e";
          b(-6,-13+bob,12,10);
          ctx.fillStyle="#fff";b(-4,-12+bob,3,3);b(3,-12+bob,3,3);
          ctx.fillStyle="#000";b(-3,-11+bob,2,2);b(4,-11+bob,2,2);
          // mouth
          ctx.fillStyle="#14532d";b(-3,-8+bob,6,2);
          // slime drip
          ctx.fillStyle="#4ade80";b(-5,-2,2,3+bob);b(3,-2,2,4+bob);
          // legs
          ctx.fillStyle="#166534";b(-6,0,4,4);b(2,0,4,4);
          break;
        }
        case "spider":{
          // 8-legged armored spider
          const legA=e.animF%4<2?1:-1;
          ctx.fillStyle="#7c2d12";
          // legs
          for(let i=0;i<4;i++){
            const lx=-10+i*7,la=legA*(i%2===0?1:-1);
            b(lx,-6,2,5+la);b(lx+1,-(1+la),3,2);
          }
          ctx.fillStyle="#9a3412";
          b(-9,-16,18,14);b(-11,-12,2,8);b(9,-12,2,8);
          ctx.fillStyle="#c2410c";
          b(-7,-14,14,10);
          // eyes (4 red eyes)
          ctx.fillStyle="#ef4444";
          b(-6,-14,2,2);b(-2,-14,2,2);b(2,-14,2,2);b(6,-14,2,2);
          // pincers
          ctx.fillStyle="#7c2d12";
          b(-8,-18,3,4);b(5,-18,3,4);
          break;
        }
        case "bat":{
          // Flying bat
          const wing=Math.sin(e.animF*0.6)*8;
          ctx.fillStyle="#4c1d95";
          b(-14+wing,-12,12,8);b(2,-12,12-wing,8);
          b(-12+wing,-10,3,4);b(9,-10,3+wing,4);
          ctx.fillStyle="#7c3aed";
          b(-6,-14,12,10);
          ctx.fillStyle="#c4b5fd";
          b(-4,-12,8,6);
          ctx.fillStyle="#ef4444";
          b(-3,-13,2,2);b(1,-13,2,2);
          ctx.fillStyle="#fff";
          b(-4,-9,2,2);b(2,-9,2,2);// fangs
          break;
        }
        case "worm":{
          // Worm that pops up from ground
          const rise=e.hidden?0:Math.min(1,e.emergeTimer/20);
          const wobble=Math.sin(e.animF*0.4)*3;
          ctx.fillStyle="#4d7c0f";
          b(-5,-(14*rise)+wobble,10,14*rise);
          b(-4,-(13*rise),8,12*rise);
          ctx.fillStyle="#65a30d";
          b(-3,-(12*rise)+wobble,6,10*rise);
          if(rise>0.8){
            // head
            ctx.fillStyle="#365314";
            b(-5,-(15*rise),10,4);
            ctx.fillStyle="#fff";
            b(-3,-(14*rise)+1,2,2);b(1,-(14*rise)+1,2,2);
            ctx.fillStyle="#ef4444";
            b(-2,-(14*rise)+2,1,1);b(2,-(14*rise)+2,1,1);
          }
          break;
        }
        case "crab":{
          // Shield crab with shell
          const legA=e.animF%4<2?1:-1;
          // claws
          ctx.fillStyle="#0369a1";
          b(-14,-10,6,6);b(8,-10,6,6);
          b(-16,-12,4,4);b(12,-12,4,4);
          ctx.fillStyle="#0284c7";
          b(-8,-16,16,14);b(-10,-12,2,8);b(8,-12,2,8);
          ctx.fillStyle="#38bdf8";
          b(-6,-14,12,10);
          ctx.fillStyle="#fff";
          b(-4,-13,3,3);b(2,-13,3,3);
          ctx.fillStyle="#000";
          b(-3,-12,2,2);b(3,-12,2,2);
          // legs
          ctx.fillStyle="#0369a1";
          b(-7,0,3,4+legA);b(-2,0,3,3-legA);b(2,0,3,4+legA);
          // shell shield
          ctx.fillStyle="rgba(14,165,233,0.5)";
          b(-10,-18,22,20);
          ctx.strokeStyle="#38bdf8";ctx.lineWidth=1.5;
          ctx.strokeRect(-10*P,-18*P,22*P,20*P);
          break;
        }
        case "spitter":{
          // Acid spitter turret creature
          ctx.fillStyle="#7f1d1d";
          b(-10,-18,20,18);b(-12,-14,2,10);b(10,-14,2,10);
          ctx.fillStyle="#991b1b";
          b(-8,-16,16,14);
          // multiple eyes
          ctx.fillStyle="#fbbf24";
          b(-6,-15,3,3);b(0,-15,3,3);b(6,-15,3,3);
          ctx.fillStyle="#000";
          b(-5,-14,1,1);b(1,-14,1,1);b(7,-14,1,1);
          // mouth tube
          const px2=Math.atan2(pl.y-16-(e.y+e.h/2),pl.x-e.x);
          ctx.save();
          ctx.rotate(e.dir===1?Math.PI-px2:px2);
          ctx.fillStyle="#374151";b(0,-2,16,4);ctx.fillStyle="#6b7280";b(0,-2,16,2);
          ctx.restore();
          break;
        }
        case "bug":{
          // Flame bug
          const legA=e.animF%4<2?1:-1;
          ctx.fillStyle="#78350f";
          b(-6,0,4,4+legA);b(2,0,4,4-legA);
          ctx.fillStyle="#92400e";
          b(-9,-14,18,14);b(-11,-10,2,8);b(9,-10,2,8);
          ctx.fillStyle="#b45309";
          b(-7,-12,14,10);
          ctx.fillStyle="#fbbf24";
          b(-4,-12,3,3);b(2,-12,3,3);
          // flame mouth
          if(e.flameT>0){
            for(let i=0;i<5;i++){
              ctx.globalAlpha=(0.4+Math.random()*0.5);
              ctx.fillStyle=`hsl(${Math.random()*40+10},100%,60%)`;
              ctx.fillRect((9+i*8)*P,(Math.random()*6-9)*P,8*P,10*P);
            }
            ctx.globalAlpha=1;
          }
          ctx.fillStyle="#92400e";b(9,-5,5,3);b(13,-4,5,3);
          break;
        }
      }
      ctx.globalAlpha=1;ctx.filter="none";ctx.restore();
    }

    //──── BACKGROUND DRAWING ────────────────────────────────────────────────
    function drawBG(lv:LevelDef,camX:number,frame:number){
      // Sky gradient
      const sg=ctx.createLinearGradient(0,0,0,GY);
      sg.addColorStop(0,lv.skyA);sg.addColorStop(1,lv.skyB);
      ctx.fillStyle=sg;ctx.fillRect(0,0,CW,GY);

      if(lv.world===1){
        // Moon
        ctx.fillStyle="#fffde7";ctx.beginPath();ctx.arc(CW-80-(camX*0.03)%200,50,28,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#fef3c7";ctx.beginPath();ctx.arc(CW-80-(camX*0.03)%200,50,22,0,Math.PI*2);ctx.fill();
        // Stars
        for(let i=0;i<25;i++){
          const sx=((i*137+camX*0.02)%(CW+20)+CW+20)%(CW+20)-10;
          const sy=(i*83)%100;
          ctx.fillStyle=`rgba(255,255,255,${0.3+Math.sin(frame*0.04+i)*0.2})`;
          ctx.fillRect(sx,sy,2,2);
        }
        // Far mountains (0.2x parallax) - dark silhouette
        const mx=-(camX*0.18)%600;
        ctx.fillStyle="#112a0c";
        for(let i=-1;i<4;i++){
          const bx=mx+i*600;
          ctx.beginPath();
          ctx.moveTo(bx,GY);
          ctx.lineTo(bx+80,GY-120);ctx.lineTo(bx+160,GY-75);
          ctx.lineTo(bx+240,GY-140);ctx.lineTo(bx+320,GY-90);
          ctx.lineTo(bx+400,GY-110);ctx.lineTo(bx+490,GY-65);
          ctx.lineTo(bx+600,GY);ctx.fill();
          // snow caps
          ctx.fillStyle="#c7f3b4";
          ctx.beginPath();ctx.moveTo(bx+240,GY-140);ctx.lineTo(bx+228,GY-118);ctx.lineTo(bx+252,GY-118);ctx.fill();
          ctx.beginPath();ctx.moveTo(bx+80,GY-120);ctx.lineTo(bx+68,GY-100);ctx.lineTo(bx+92,GY-100);ctx.fill();
          ctx.fillStyle="#112a0c";
        }
        // Mid trees (0.5x parallax)
        const tx=-(camX*0.5)%360;
        for(let i=-1;i<5;i++){
          const bx=tx+i*360;
          // large trees layered
          ctx.fillStyle="#0a3d0a";
          ctx.fillRect(bx+10,GY-95,14,95);
          ctx.fillRect(bx+4,GY-110,26,55);ctx.fillRect(bx+8,GY-125,18,30);ctx.fillRect(bx+12,GY-138,10,18);
          ctx.fillStyle="#145214";
          ctx.fillRect(bx+5,GY-105,24,48);ctx.fillRect(bx+9,GY-120,16,26);
          ctx.fillStyle="#0a3d0a";
          ctx.fillRect(bx+90,GY-75,12,75);
          ctx.fillRect(bx+85,GY-90,22,44);ctx.fillRect(bx+88,GY-103,16,22);
          ctx.fillStyle="#0a3d0a";
          ctx.fillRect(bx+190,GY-105,14,105);
          ctx.fillRect(bx+183,GY-120,28,55);ctx.fillRect(bx+187,GY-135,20,30);ctx.fillRect(bx+191,GY-148,12,18);
          ctx.fillStyle="#166534";
          ctx.fillRect(bx+184,GY-115,26,48);
          // palm-style
          ctx.fillStyle="#0a3d0a";
          ctx.fillRect(bx+280,GY-65,8,65);
          for(let j=0;j<5;j++){const a2=(j/5)*Math.PI;ctx.fillRect(bx+284+Math.cos(a2)*22,GY-65+Math.sin(a2)*6,20,5);}
        }
        // Near bushes/grass (0.8x) — these serve as enemy hiding spots
        const gx2=-(camX*0.8)%200;
        ctx.fillStyle="#166534";
        for(let i=-1;i<6;i++){
          const bx2=gx2+i*200;
          ctx.fillRect(bx2,GY-20,30,20);ctx.fillRect(bx2+5,GY-30,20,14);ctx.fillRect(bx2+8,GY-35,14,10);
          ctx.fillRect(bx2+80,GY-16,24,16);ctx.fillRect(bx2+84,GY-24,16,10);
          ctx.fillRect(bx2+140,GY-22,28,22);ctx.fillRect(bx2+144,GY-32,20,14);ctx.fillRect(bx2+148,GY-38,12,10);
        }

      } else if(lv.world===2){
        ctx.fillStyle="#0d0d1a";ctx.fillRect(0,0,CW,GY);
        // Factory pipes (parallax 0.3x)
        const px3=-(camX*0.3)%220;
        for(let i=-1;i<5;i++){
          const bx=px3+i*220;
          ctx.fillStyle="#1f2937";ctx.fillRect(bx,0,20,GY);
          ctx.fillStyle="#374151";ctx.fillRect(bx,0,5,GY);ctx.fillRect(bx+14,0,4,GY*0.65);
          ctx.fillStyle="#6b7280";
          for(let j=0;j<6;j++)ctx.fillRect(bx-3,30+j*55,26,8);
          // horizontal connecting pipes
          ctx.fillStyle="#1f2937";ctx.fillRect(bx,GY-120,220,10);ctx.fillRect(bx,GY-160,220,8);
          ctx.fillStyle="#374151";ctx.fillRect(bx,GY-120,220,3);
        }
        // Warning lights with glow
        const wl=Math.floor(frame/22)%2;
        for(let i=0;i<8;i++){
          const lx2=((i*100-camX*0.5)%(CW+100)+CW+100)%(CW+100)-50;
          ctx.fillStyle=wl===0?"#dc2626":"#f59e0b";
          ctx.fillRect(lx2-6,12,12,12);
          ctx.fillStyle=wl===0?"rgba(220,38,38,0.2)":"rgba(245,158,11,0.2)";
          ctx.beginPath();ctx.arc(lx2,18,28,0,Math.PI*2);ctx.fill();
        }
        // Hazard stripes on ground edge
        const hs=-(camX*0.5)%72;
        for(let i=-1;i<12;i++){
          ctx.fillStyle=i%2===0?"#f59e0b":"#374151";
          ctx.fillRect(hs+i*72,GY-4,36,4);
        }
      } else {
        // Alien lair
        const pulse=0.5+Math.sin(frame*0.025)*0.3;
        ctx.fillStyle=`rgba(40,0,70,${0.5+pulse*0.15})`;ctx.fillRect(0,0,CW,GY);
        ctx.strokeStyle=`rgba(168,85,247,${0.12+pulse*0.08})`;ctx.lineWidth=3;
        for(let i=0;i<6;i++){
          const vx=((i*140-camX*0.2)%(CW+200)+CW+200)%(CW+200)-80;
          ctx.beginPath();ctx.moveTo(vx,0);ctx.bezierCurveTo(vx+40,GY*0.3,vx-30,GY*0.6,vx+15,GY);ctx.stroke();
        }
        // Alien eggs in background
        ctx.fillStyle="rgba(80,20,50,0.7)";
        const ex3=-(camX*0.4)%260;
        for(let i=-1;i<4;i++){
          for(let j=0;j<4;j++){
            ctx.beginPath();ctx.ellipse(ex3+i*260+j*30,GY-15,10,14,0,0,Math.PI*2);ctx.fill();
          }
        }
        // Pulsing orbs
        for(let i=0;i<5;i++){
          const ox=((i*150-camX*0.3)%(CW+200)+CW+200)%(CW+200)-80;
          ctx.fillStyle=`rgba(167,139,250,${0.08+Math.sin(frame*0.05+i)*0.05})`;
          ctx.beginPath();ctx.arc(ox,80+i*30,30+i*10,0,Math.PI*2);ctx.fill();
        }
      }
    }

    function drawGround(lv:LevelDef,camX:number,frame:number){
      const gx=-(camX%36);
      ctx.fillStyle=lv.groundCol;
      ctx.fillRect(0,GY,CW,CH-GY);

      if(lv.world===1){
        // Grass top line
        ctx.fillStyle=lv.groundLine;ctx.fillRect(0,GY,CW,5);
        // Animated grass tufts
        ctx.fillStyle="#22c55e";
        for(let i=-1;i<22;i++){
          const gxx=gx+i*32;
          ctx.fillRect(gxx,GY-3,3,7);ctx.fillRect(gxx+8,GY-4,2,9);
          ctx.fillRect(gxx+16,GY-3,3,6);ctx.fillRect(gxx+24,GY-4,2,8);
        }
        // Ground detail rocks
        ctx.fillStyle="#5c4a2a";
        for(let i=0;i<8;i++){
          const rx=((i*280+100-camX)%(CW+280)+CW+280)%(CW+280)-140;
          ctx.fillRect(rx,GY+5,8,5);ctx.fillRect(rx+4,GY+4,6,4);
        }
        // Sandbag walls at certain intervals
        const sbPositions=[600,1300,2100,2900,3600];
        for(const sbx of sbPositions){
          const sx=sbx-camX;
          if(sx<-80||sx>CW+80)continue;
          // wall
          ctx.fillStyle="#d4a96a";ctx.fillRect(sx,GY-30,50,30);
          ctx.fillStyle="#b8935a";ctx.fillRect(sx+3,GY-26,44,22);
          ctx.fillStyle="#d4a96a";
          ctx.fillRect(sx+5,GY-32,14,7);ctx.fillRect(sx+28,GY-32,14,7);
          // top sandbag row
          ctx.fillStyle="#c4974a";ctx.fillRect(sx+2,GY-34,46,6);
        }
        // Water section
        if(lv.waterX){
          const wx=lv.waterX-camX;
          const ww=lv.waterW??280;
          if(wx<CW&&wx+ww>0){
            const wa=Math.max(0,wx),wb=Math.min(ww,CW-Math.max(0,wx));
            ctx.fillStyle=`rgba(29,78,216,${0.75+Math.sin(frame*0.04)*0.08})`;
            ctx.fillRect(wa,GY,wb,CH-GY);
            // water ripples
            ctx.fillStyle="rgba(147,197,253,0.35)";
            for(let i=0;i<5;i++){
              const ry=GY+4+i*8;
              ctx.fillRect(wa,ry,wb,3);
            }
            // animated wave
            for(let i=0;i<4;i++){
              ctx.fillStyle="rgba(186,230,253,0.4)";
              ctx.fillRect(wa+((frame*2+i*55)%(wb+55))-20,GY+3,40,5);
            }
            // WATER label
            ctx.fillStyle="rgba(147,197,253,0.6)";ctx.font='6px "Press Start 2P",monospace';
            ctx.textAlign="center";ctx.fillText("WATER",wa+wb/2,GY-5);ctx.textAlign="left";
          }
        }
        // Explosive barrels
        const barPositions=[500,1000,1650,2400,3200];
        for(const barx of barPositions){
          const sx=barx-camX;if(sx<-40||sx>CW+40)continue;
          ctx.fillStyle="#991b1b";ctx.fillRect(sx,GY-24,18,24);
          ctx.fillStyle="#6b7280";ctx.fillRect(sx-1,GY-26,20,4);ctx.fillRect(sx-1,GY-14,20,3);
          ctx.fillStyle="#fbbf24";ctx.fillRect(sx+4,GY-20,10,6); // hazard stripe
        }

      } else if(lv.world===2){
        // Metal floor
        ctx.fillStyle=lv.groundLine;ctx.fillRect(0,GY,CW,4);
        for(let i=-1;i<20;i++){
          ctx.fillStyle="#4b5563";ctx.fillRect(gx+i*40,GY+4,38,9);
          ctx.fillStyle="#374151";ctx.fillRect(gx+i*40,GY+13,38,5);
          ctx.fillStyle="#9ca3af";ctx.fillRect(gx+i*40,GY+4,2,9);
        }
        // Crates
        const cPositions=[900,1600,2400,3100];
        for(const cx2 of cPositions){
          const sx=cx2-camX;if(sx<-40||sx>CW+40)continue;
          ctx.fillStyle="#854d0e";ctx.fillRect(sx,GY-28,28,28);
          ctx.fillStyle="#92400e";ctx.fillRect(sx+2,GY-26,24,24);
          ctx.fillStyle="#713f12";ctx.fillRect(sx,GY-14,28,2);ctx.fillRect(sx+12,GY-28,2,28);
        }
      } else {
        // Organic ground
        ctx.fillStyle=lv.groundLine;ctx.fillRect(0,GY,CW,5);
        ctx.fillStyle="#6d28d9";
        for(let i=-1;i<22;i++){ctx.beginPath();ctx.ellipse(gx+i*34+17,GY,22,10,0,0,Math.PI);ctx.fill();}
        // Acid pits
        for(let i=0;i<2;i++){
          const apx=1900+i*900-camX;
          if(apx<CW&&apx+110>0){
            ctx.fillStyle=`rgba(0,255,80,${0.6+Math.sin(frame*0.08+i)*0.2})`;
            ctx.fillRect(Math.max(0,apx),GY,Math.min(110,CW-Math.max(0,apx)),CH-GY);
            ctx.fillStyle="rgba(167,243,208,0.35)";
            for(let j=0;j<3;j++)ctx.fillRect(Math.max(0,apx)+j*36+Math.sin(frame*0.1+j)*8,GY+3,28,4);
            ctx.fillStyle="rgba(74,222,128,0.7)";ctx.font='5px "Press Start 2P",monospace';
            ctx.textAlign="center";ctx.fillText("ACID",Math.max(0,apx)+55,GY-5);ctx.textAlign="left";
          }
        }
      }
    }

    function drawBushes(lv:LevelDef,camX:number){
      // Draw Contra-style foreground bushes (enemy hiding spots)
      for(const bush of lv.bushes){
        const sx=bush.x-camX;
        if(sx>CW+80||sx+bush.w<-80)continue;
        // Dense bush
        ctx.fillStyle="#166534";
        ctx.fillRect(sx,bush.y,bush.w,bush.h);
        ctx.fillStyle="#15803d";
        ctx.fillRect(sx+4,bush.y-8,bush.w-8,12);
        ctx.fillRect(sx+8,bush.y-14,bush.w-16,12);
        ctx.fillStyle="#14532d";
        ctx.fillRect(sx,bush.y+bush.h-6,bush.w,6);
        // leafy top
        ctx.fillStyle="#22c55e";
        ctx.fillRect(sx+6,bush.y-12,10,8);ctx.fillRect(sx+bush.w-16,bush.y-10,10,7);
        ctx.fillRect(sx+bush.w/2-8,bush.y-16,16,10);
      }
    }

    function drawPlats(lv:LevelDef,camX:number){
      for(const p of lv.plats){
        const sx=p.x-camX;
        if(sx>CW+60||sx+p.w<-60)continue;
        // shadow
        ctx.fillStyle="rgba(0,0,0,0.25)";ctx.fillRect(sx+4,p.y+p.h+2,p.w,4);
        ctx.fillStyle=lv.platCol;ctx.fillRect(sx,p.y,p.w,p.h);
        ctx.fillStyle=lv.platTop;ctx.fillRect(sx,p.y,p.w,4);
        // detail
        if(lv.world===1){
          ctx.fillStyle="#3d2b1a";
          for(let i=0;i<Math.floor(p.w/16);i++)ctx.fillRect(sx+i*16,p.y,1,p.h);
        } else if(lv.world===2){
          ctx.fillStyle="#9ca3af";
          for(let i=0;i<Math.floor(p.w/24);i++)ctx.fillRect(sx+i*24+5,p.y+4,4,4);
        }
      }
    }

    function drawHUD(){
      ctx.fillStyle="rgba(0,0,0,0.55)";ctx.fillRect(0,0,CW,28);
      ctx.font='7px "Press Start 2P",monospace';
      // Lives
      ctx.fillStyle="#ff69b4";ctx.fillText("P1",8,16);
      for(let i=0;i<Math.min(pl.lives,6);i++){
        ctx.fillStyle="#ff69b4";ctx.fillRect(30+i*15,4,10,12);
        ctx.fillStyle="#7c3aed";ctx.fillRect(38+i*15,8,4,3);
        ctx.fillStyle="#fff";ctx.fillRect(36+i*15,5,3,3);
      }
      // Score
      ctx.textAlign="center";
      ctx.fillStyle="#fff";ctx.fillText("SCORE",CW/2,12);
      ctx.fillText(String(pl.score).padStart(7,"0"),CW/2,22);
      ctx.fillStyle="#fbbf24";ctx.fillText("HI",CW/2+110,12);
      ctx.fillText(String(pl.hi).padStart(7,"0"),CW/2+100,22);
      // Weapon
      ctx.fillStyle="#1f2937";ctx.fillRect(CW-28,2,26,24);
      ctx.strokeStyle="#f59e0b";ctx.lineWidth=1;ctx.strokeRect(CW-28,2,26,24);
      ctx.fillStyle="#fff";ctx.font='9px "Press Start 2P",monospace';ctx.fillText(pl.wp,CW-22,19);
      // Status
      ctx.font='5px "Press Start 2P",monospace';
      if(pl.rapid>0){ctx.fillStyle="#facc15";ctx.fillText(`RAPID ${Math.ceil(pl.rapid/60)}`,CW-105,40);}
      if(pl.barrier>0){ctx.fillStyle="#67e8f9";ctx.fillText(`SHIELD ${Math.ceil(pl.barrier/60)}`,CW-108,50);}
      if(pl.bombs>0){ctx.fillStyle="#fb923c";ctx.fillText(`BOMB×${pl.bombs}`,8,CH-10);}
      ctx.textAlign="left";
    }

    function drawBossHUD(b:Boss){
      const bw=CW-44;const ratio=Math.max(0,b.hp/b.maxHp);
      ctx.fillStyle="#1f2937";ctx.fillRect(22,CH-18,bw,10);
      ctx.fillStyle=ratio>0.5?"#22c55e":ratio>0.25?"#f59e0b":"#ef4444";
      ctx.fillRect(22,CH-18,bw*ratio,10);
      ctx.strokeStyle="#ef4444";ctx.lineWidth=2;ctx.strokeRect(22,CH-18,bw,10);
      ctx.fillStyle="#ef4444";ctx.font='6px "Press Start 2P",monospace';ctx.fillText("BOSS",22,CH-22);
    }

    function drawBoss(b:Boss,camX:number){
      const bx=b.x-camX;ctx.save();
      if(b.flashT>0)ctx.filter="brightness(6)";
      if(b.world===1){
        // Gate
        ctx.fillStyle="#3d2b1a";ctx.fillRect(bx,b.y,b.w,b.h);
        ctx.fillStyle="#2d1f0e";ctx.fillRect(bx+6,b.y+6,b.w-12,b.h-30);
        // rivets
        ctx.fillStyle="#6b7280";
        [[5,5],[b.w-9,5],[5,b.h-14],[b.w-9,b.h-14]].forEach(([rx,ry])=>{ctx.beginPath();ctx.arc(bx+rx,b.y+ry,4,0,Math.PI*2);ctx.fill();});
        ctx.fillStyle="#4b5563";ctx.fillRect(bx-18,b.y+28,22,12);ctx.fillRect(bx+b.w-4,b.y+28,22,12);
        ctx.fillStyle="#6b7280";ctx.fillRect(bx+b.w/2-18,b.y-18,36,18);
        const ang=Math.atan2(pl.y-16-(b.y-10),pl.x-b.x);
        ctx.save();ctx.translate(bx+b.w/2,b.y-10);ctx.rotate(ang);
        ctx.fillStyle="#374151";ctx.fillRect(0,-4,28,8);ctx.fillStyle="#4b5563";ctx.fillRect(0,-3,28,3);
        ctx.restore();
        const blink=Math.floor(b.timer/10)%2===0;
        ctx.fillStyle=blink?"#ef4444":"#991b1b";
        ctx.beginPath();ctx.arc(bx+b.w/2,b.y+b.h/2-10,15,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=blink?"#fca5a5":"#dc2626";
        ctx.beginPath();ctx.arc(bx+b.w/2,b.y+b.h/2-10,8,0,Math.PI*2);ctx.fill();
      } else if(b.world===2){
        const pulse=1+Math.sin(b.timer*0.06)*0.1;
        ctx.fillStyle="#4c1d95";ctx.beginPath();ctx.ellipse(bx,b.y,46*pulse,58*pulse,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#7c3aed";ctx.beginPath();ctx.ellipse(bx,b.y,34*pulse,44*pulse,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#a855f7";ctx.beginPath();ctx.ellipse(bx,b.y,22*pulse,28*pulse,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle="#6d28d9";ctx.lineWidth=3;
        for(let i=0;i<6;i++){const a=i*Math.PI/3+b.timer*0.01;ctx.beginPath();ctx.moveTo(bx,b.y);ctx.lineTo(bx+Math.cos(a)*44*pulse,b.y+Math.sin(a)*56*pulse);ctx.stroke();}
        b.eyes?.forEach(eye=>{
          if(eye.dead){ctx.fillStyle="#1f2937";ctx.beginPath();ctx.arc(bx+eye.x,b.y+eye.y,14,0,Math.PI*2);ctx.fill();return;}
          const ea=Math.atan2(pl.y-(b.y+eye.y),pl.x-(b.x+eye.x));
          ctx.fillStyle="#dc2626";ctx.beginPath();ctx.arc(bx+eye.x,b.y+eye.y,16,0,Math.PI*2);ctx.fill();
          ctx.fillStyle="#fbbf24";ctx.beginPath();ctx.arc(bx+eye.x+Math.cos(ea)*6,b.y+eye.y+Math.sin(ea)*6,7,0,Math.PI*2);ctx.fill();
          ctx.fillStyle="#000";ctx.beginPath();ctx.arc(bx+eye.x+Math.cos(ea)*8,b.y+eye.y+Math.sin(ea)*8,3,0,Math.PI*2);ctx.fill();
        });
        if(b.coreExp){const cp=1+Math.sin(b.timer*0.12)*0.2;ctx.fillStyle="#f0abfc";ctx.beginPath();ctx.arc(bx,b.y,16*cp,0,Math.PI*2);ctx.fill();}
      } else {
        const hw=b.w/2,hh=b.h/2;
        ctx.fillStyle="#1c0128";ctx.beginPath();ctx.ellipse(bx,b.y-10,hw,hh+10,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#2d0038";ctx.beginPath();ctx.ellipse(bx,b.y-15,hw-14,hh-5,0,0,Math.PI*2);ctx.fill();
        const eb=Math.floor(b.timer/18)%8!==0;
        if(eb){
          ctx.fillStyle="#ef4444";ctx.beginPath();ctx.arc(bx-48,b.y-20,22,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+48,b.y-20,22,0,Math.PI*2);ctx.fill();
          ctx.fillStyle="#fbbf24";const eo=Math.sin(b.timer*0.07)*4;
          ctx.beginPath();ctx.arc(bx-48+eo,b.y-20,12,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+48+eo,b.y-20,12,0,Math.PI*2);ctx.fill();
          ctx.fillStyle="#000";ctx.beginPath();ctx.arc(bx-48+eo,b.y-20,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(bx+48+eo,b.y-20,5,0,Math.PI*2);ctx.fill();
        }
        ctx.fillStyle="#dc2626";ctx.beginPath();ctx.arc(bx,b.y+26,46,0,Math.PI);ctx.fill();
        ctx.fillStyle="#450a0a";ctx.beginPath();ctx.arc(bx,b.y+26,36,0,Math.PI);ctx.fill();
        ctx.fillStyle="#e5e7eb";
        for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(bx-38+i*19,b.y+26);ctx.lineTo(bx-31+i*19,b.y+46);ctx.lineTo(bx-24+i*19,b.y+26);ctx.fill();}
        if(b.laserOn){ctx.fillStyle=`rgba(239,68,68,${0.4+Math.sin(b.timer*0.35)*0.3})`;ctx.fillRect(bx-hw,b.y+26,CW+200,10);}
      }
      ctx.filter="none";ctx.restore();
    }

    function drawTouchUI(){
      // Joystick base
      ctx.globalAlpha=0.55;
      ctx.fillStyle="rgba(30,30,60,0.7)";ctx.beginPath();ctx.arc(JX,JY,JR+4,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="rgba(100,180,255,0.7)";ctx.lineWidth=3;ctx.beginPath();ctx.arc(JX,JY,JR,0,Math.PI*2);ctx.stroke();
      // Direction arrows
      ctx.fillStyle="rgba(255,255,255,0.25)";
      [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dx,dy])=>{
        ctx.beginPath();ctx.moveTo(JX+dx*(JR-10),JY+dy*(JR-10));
        ctx.lineTo(JX+dx*(JR-10)-dy*6,JY+dy*(JR-10)-dx*6);
        ctx.lineTo(JX+dx*(JR-10)+dy*6,JY+dy*(JR-10)+dx*6);
        ctx.fill();
      });
      // Knob
      const kActive=tc.active&&(Math.abs(tc.jx)>8||Math.abs(tc.jy)>8);
      ctx.globalAlpha=kActive?0.92:0.65;
      const grad=ctx.createRadialGradient(JX+tc.jx-4,JY+tc.jy-4,2,JX+tc.jx,JY+tc.jy,20);
      grad.addColorStop(0,"rgba(180,220,255,0.95)");grad.addColorStop(1,"rgba(60,120,220,0.8)");
      ctx.fillStyle=grad;ctx.beginPath();ctx.arc(JX+tc.jx,JY+tc.jy,20,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,0.6)";ctx.lineWidth=2;ctx.stroke();
      // Buttons
      const btns=[{x:JBX,y:JBY,c1:"#22c55e",c2:"#14532d",l:"JUMP",a:tc.jump},
                  {x:SBX,y:SBY,c1:"#ef4444",c2:"#7f1d1d",l:"FIRE",a:tc.shoot},
                  {x:BBX,y:BBY,c1:"#f59e0b",c2:"#78350f",l:"BOMB",a:tc.bomb}];
      for(const bt of btns){
        const r=BR*(bt.a?0.84:1);
        ctx.globalAlpha=bt.a?0.95:0.55;
        const bg=ctx.createRadialGradient(bt.x-r*0.3,bt.y-r*0.3,1,bt.x,bt.y,r);
        bg.addColorStop(0,bt.a?bt.c2:bt.c1);bg.addColorStop(1,bt.a?bt.c1:bt.c2);
        ctx.fillStyle=bg;ctx.beginPath();ctx.arc(bt.x,bt.y,r,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=bt.a?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.5)";ctx.lineWidth=bt.a?2.5:1.5;ctx.stroke();
        ctx.fillStyle="#fff";ctx.font=`6px "Press Start 2P",monospace`;ctx.textAlign="center";
        ctx.shadowColor="rgba(0,0,0,0.8)";ctx.shadowBlur=4;
        ctx.fillText(bt.l,bt.x,bt.y+2);ctx.textAlign="left";ctx.shadowBlur=0;
      }
      ctx.globalAlpha=1;
    }

    function drawScanlines(){
      ctx.fillStyle="rgba(0,0,0,0.1)";
      for(let y=0;y<CH;y+=2)ctx.fillRect(0,y,CW,1);
    }

    function drawPick(pk:Pick,camX:number){
      const sx=pk.x-camX;
      if(sx<-30||sx>CW+30)return;
      if(pk.timer<120&&Math.floor(pk.timer/6)%2===0)return;
      const bob=Math.sin(pk.bob)*4;
      const cols:Record<string,string>={S:"#f97316",L:"#06b6d4",F:"#ef4444",R:"#a855f7",B:"#e2e8f0","1UP":"#f472b6"};
      ctx.fillStyle="#1f2937";ctx.fillRect(sx-11,pk.y+bob-9,22,18);
      ctx.fillStyle=cols[pk.type]||"#fff";ctx.fillRect(sx-10,pk.y+bob-8,20,16);
      ctx.fillStyle="#fff";ctx.font='7px "Press Start 2P",monospace';ctx.textAlign="center";
      ctx.fillText(pk.type==="1UP"?"1U":pk.type,sx,pk.y+bob+4);ctx.textAlign="left";
    }

    function drawDrone(d:Drone,camX:number){
      const sx=d.x-camX;if(sx<-50||sx>CW+50)return;
      const bl=Math.floor(Date.now()/160)%2===0;
      ctx.fillStyle=bl?"#ef4444":"#991b1b";ctx.fillRect(sx-18,d.y-7,36,14);
      ctx.fillStyle="#374151";ctx.fillRect(sx-8,d.y-13,16,8);
      ctx.fillStyle="#6b7280";ctx.fillRect(sx-22,d.y-5,8,3);ctx.fillRect(sx+14,d.y-5,8,3);
      ctx.fillStyle="#fbbf24";ctx.fillRect(sx-4,d.y-2,8,4);
    }

    //──── PLAYER RECT ───────────────────────────────────────────────────────
    function plRect(){
      if(pl.prone)return{x:pl.x-14,y:pl.y-8,w:40,h:8}; // flat prone — wide, very short
      return{x:pl.x-pl.w/2,y:pl.y-pl.h,w:pl.w,h:pl.h};
    }

    //──── SHOOT ────────────────────────────────────────────────────────────
    function shootCD(){
      const r=pl.rapid>0;
      if(pl.wp==="M")return r?2:6;
      if(pl.wp==="R")return r?1:2;
      if(pl.wp==="S")return r?9:17;
      if(pl.wp==="L")return 28;
      if(pl.wp==="F")return 17;
      return 6;
    }

    function doShoot(){
      const w=pl.wp;
      const inWater=g.world===0&&pl.x>2050&&pl.x<2350;
      let bx=pl.x,by=pl.y-pl.h*0.5;
      let vx=0,vy=0;
      const spd=w==="R"?12:8;

      if(pl.prone){
        // Bullet spawns at prone gun barrel height (very low, along the floor)
        bx=pl.x+pl.dir*22;by=pl.y-5;vx=pl.dir*spd;vy=0;
      } else if(pl.aimUp){
        bx=pl.x;by=pl.y-pl.h-4;vx=0;vy=-spd;
      } else if(pl.aimDiag){
        bx=pl.x+pl.dir*12;by=pl.y-pl.h+4;vx=pl.dir*spd*0.7;vy=-spd*0.7;
      } else {
        bx=pl.x+pl.dir*18;by=pl.y-14;vx=pl.dir*spd;vy=0;
      }

      if(w==="M"||w==="R"){spawnBul(bx,by,vx,vy,true,w);sfxShoot();}
      else if(w==="S"){
        if(!inWater){
          const base=Math.atan2(vy,vx);
          [-20,-10,0,10,20].forEach(a=>{const r2=base+a*Math.PI/180;spawnBul(bx,by,Math.cos(r2)*7,Math.sin(r2)*7,true,"S");});
          [0,1,2].forEach(i=>setTimeout(()=>tone(800+i*100,"square",0.05,0.09),i*14));
        } else{spawnBul(bx,by,vx,vy,true,"S");sfxShoot();}
      }
      else if(w==="L"){const lv2=spd*2;spawnBul(bx,by,vx>0?lv2:vx<0?-lv2:vx,vy>0?lv2:vy<0?-lv2:vy,true,"L",999);sfxShoot();}
      else if(w==="F"){spawnBul(bx,by,vx,vy-1.5,true,"F");spawnBul(bx,by,vx,vy+1.5,true,"F");sfxShoot();}
    }

    //──── UPDATE ───────────────────────────────────────────────────────────
    function updBuls(lv:LevelDef){
      for(let i=buls.length-1;i>=0;i--){
        const b2=buls[i];
        if(b2.dead){buls.splice(i,1);continue;}
        b2.x+=b2.vx;b2.y+=b2.vy;
        if(b2.wp==="F"){b2.sp=(b2.sp??0)+0.22;b2.sd=b2.sd??1;b2.y+=Math.sin(b2.sp)*1.8*b2.sd;}
        if(!b2.pl&&b2.wp!=="L")b2.vy+=0.04;
        // Kill if too far from camera in world coords
        if(b2.x<g.camX-120||b2.x>g.camX+CW+120||b2.y<-100||b2.y>CH+120){b2.dead=true;continue;}
        if(b2.y>GY){b2.dead=true;if(b2.pl)burst(b2.x,GY,3,["#facc15","#fbbf24"],2);continue;}
        // Platform collision
        for(const p of lv.plats){
          if(b2.y>p.y&&b2.y<p.y+p.h+4&&b2.x>p.x&&b2.x<p.x+p.w){b2.dead=true;break;}
        }
      }
    }

    function updPlayer(lv:LevelDef){
      if(pl.dead){
        pl.deadT--;pl.animF++;pl.y+=2.5;
        if(pl.deadT<=0){
          pl.lives--;
          if(pl.lives<=0){
            pl.hi=Math.max(pl.hi,pl.score);
            try{localStorage.setItem("ph",String(pl.hi));}catch(_){}
            g.phase="over";g.overT=0;g.contCount=9;g.contT=0;
          } else respawn();
        }
        return;
      }
      if(pl.inv>0)pl.inv--;
      if(pl.barrier>0)pl.barrier--;
      if(pl.rapid>0)pl.rapid--;
      if(pl.flash>0)pl.flash--;

      const kL=K["ArrowLeft"]||(tc.active&&tc.jx<-18);
      const kR=K["ArrowRight"]||(tc.active&&tc.jx>18);
      const kU=K["ArrowUp"]||(tc.active&&tc.jy<-20);
      const kD=K["ArrowDown"]||(tc.active&&tc.jy>22);
      const kSh=K["x"]||K["X"]||tc.shoot;
      const kJu=K[" "]||tc.jump;
      const kBo=K["z"]||K["Z"]||tc.bomb;

      if(kL&&!kR)pl.dir=-1;
      if(kR&&!kL)pl.dir=1;
      pl.aimUp=kU&&!kD&&!pl.prone;
      pl.aimDiag=pl.aimUp&&(kL||kR);

      // Crouch: Down on ground (works with any direction, including Right+Down)
      if(kD&&pl.onGrd){pl.prone=true;pl.aimUp=false;pl.aimDiag=false;}
      else if(!kD)pl.prone=false;

      const inWater=g.world===0&&pl.x>2050&&pl.x<2350;
      const spd=inWater?PSPEED*0.6:PSPEED;
      if(!pl.prone){
        if(kL&&!kR)pl.vx=-spd;
        else if(kR&&!kL)pl.vx=spd;
        else pl.vx*=0.72;
      } else {
        // Allow slow duck-walk while crouching
        if(kL&&!kR)pl.vx=-spd*0.55;
        else if(kR&&!kL)pl.vx=spd*0.55;
        else pl.vx*=0.6;
      }

      const jumpDown=(kJu||tc.jumpNow)&&!pl.jumpConsumed;
      if(jumpDown&&pl.onGrd){pl.vy=JUMP_FORCE;pl.onGrd=false;pl.jumpConsumed=true;sfxJump();}
      if(!(K[" "]||tc.jump))pl.jumpConsumed=false;
      tc.jumpNow=false;
      if(kD&&!pl.onGrd)pl.vy+=0.5*dtS;
      pl.vy=Math.min(pl.vy+GRAVITY*dtS,12);
      pl.x+=pl.vx*dtS;pl.y+=pl.vy*dtS;

      // Ground/platform collision + auto-step-up (climb small ledges)
      pl.onGrd=false;
      const STEP_H=14; // max step height to auto-climb
      for(const p of lv.plats){
        const pr=plRect();
        const prevBot=pr.y+pr.h-pl.vy;
        // Landing on top
        if(pr.x+pr.w>p.x&&pr.x<p.x+p.w&&prevBot<=p.y+2&&pr.y+pr.h>=p.y&&pl.vy>=0){
          pl.y=p.y+(pl.prone?8:pl.h);pl.vy=0;pl.onGrd=true;
          if(p.moving&&p.vx)pl.x+=p.vx;
        }
        // Auto-step-up: walking into side of platform that's within STEP_H above feet
        else if(pl.onGrd&&!pl.prone&&Math.abs(pl.vx)>0){
          const feet=pl.y; // pl.y is feet position
          const platTop=p.y;
          const stepUp=feet-platTop; // how high the platform top is above feet (negative means below)
          if(stepUp>0&&stepUp<=STEP_H&&pr.x+pr.w>p.x-2&&pr.x<p.x+p.w+2&&pr.y+pr.h>p.y&&pr.y<p.y+p.h){
            pl.y=platTop+pl.h;pl.vy=0;pl.onGrd=true;
          }
        }
      }
      if(pl.y>=GY){pl.y=GY;pl.vy=0;pl.onGrd=true;}
      pl.x=Math.max(g.camX+28,pl.x);
      if(pl.y>CH+80)plHit();
      // Acid
      if(lv.world===3){for(let i=0;i<2;i++){const apx=1900+i*900;if(pl.x>apx&&pl.x<apx+110&&pl.onGrd)plHit();}}

      pl.animT++;if(pl.animT>=6){pl.animT=0;pl.animF=(pl.animF+1)%16;}
      if(pl.shootT>0)pl.shootT--;
      if(kSh&&pl.shootT<=0){pl.shootT=shootCD();pl.flash=2;doShoot();}

      if(kBo&&pl.bombs>0){
        pl.bombs--;
        enemies.forEach(e=>{if(!e.dead&&!e.hidden){e.dead=true;pl.score+=100;burst(e.x,e.y,8,["#f97316","#fbbf24","#fff"],4);}});
        sfxBigExp();g.flashA=0.7;g.shakeX=5;g.shakeDur=16;
      }

      // Bullet hits player
      if(pl.inv<=0&&pl.barrier<=0){
        const pr=plRect();
        for(const b2 of buls){
          if(b2.dead||b2.pl)continue;
          if(hit(b2.x-5,b2.y-5,10,10,pr.x,pr.y,pr.w,pr.h)){b2.dead=true;plHit();break;}
        }
      }
      // Pickups
      const pr2=plRect();
      for(const pk of picks){
        if(pk.dead)continue;
        if(hit(pr2.x,pr2.y,pr2.w,pr2.h,pk.x-12,pk.y-12,24,24))collectPick(pk);
      }
    }

    function plHit(){
      if(pl.dead||pl.inv>0||pl.barrier>0)return;
      pl.dead=true;pl.deadT=95;pl.wp="M";pl.rapid=0;pl.barrier=0;
      sfxExp();g.flashA=0.85;g.shakeX=5;g.shakeDur=14;
      burst(pl.x,pl.y-14,18,["#ff69b4","#d63384","#fbbf24","#fff","#f9a8d4"],5);
    }
    function respawn(){
      pl.x=g.camX+80;pl.y=GY;pl.vx=0;pl.vy=0;pl.dead=false;pl.prone=false;pl.onGrd=false;pl.inv=120;
    }
    function collectPick(pk:Pick){
      pk.dead=true;sfxPickup();g.flashA=0.22;
      if(pk.type==="S"||pk.type==="L"||pk.type==="F"||pk.type==="R")pl.wp=pk.type;
      else if(pk.type==="B")pl.barrier=720;
      else if(pk.type==="1UP"){pl.lives++;tone(523,"sine",0.5,0.2);}
      pl.score+=500;
    }

    function preSpawnAll(lv:LevelDef){
      for(let i=0;i<lv.spawns.length;i++){
        const sp=lv.spawns[i];
        spawnEnemy(sp.x,sp.type,sp.groundY,false); // visible immediately, no woosh
        g.spawned[i]=true;
      }
    }

    function updEnemies(lv:LevelDef){

      for(let i=enemies.length-1;i>=0;i--){
        const e=enemies[i];
        if(e.dead){enemies.splice(i,1);continue;}
        const ex=e.x-g.camX;
        if(ex<-300||ex>CW+300)continue;
        if(e.spawnProtect>0){e.spawnProtect--;continue;}

        e.animT++;if(e.animT>=8){e.animT=0;e.animF=(e.animF+1)%8;}
        if(e.flashT>0)e.flashT--;

        const dist=Math.abs(pl.x-e.x);
        // No hidden/emerging — enemies are always present
        if(e.hidden)e.hidden=false;
        if(e.emerging)e.emerging=false;

        // Movement: ALL enemies move LEFT (toward player who starts left)
        // They don't walk back — they always advance left
        const moveLeft=()=>{e.x-=(e.type==="spider"||e.type==="spitter"?1.1:1.8);};

        if(e.type==="bat"){
          // Bat swoops down
          const targetX=pl.x,targetY=pl.y-40;
          e.x+=(targetX-e.x)*0.018;
          e.y+=(targetY-e.y)*0.018;
          if(e.shootT<=0&&dist<300){
            e.shootT=e.shootCD;
            const dx=pl.x-e.x,dy=pl.y-e.y,mg=Math.hypot(dx,dy);
            spawnBul(e.x,e.y,(dx/mg)*4,(dy/mg)*4,false);
          }
          if(e.shootT>0)e.shootT--;
          // Contact damage
          if(!pl.dead&&pl.inv<=0&&pl.barrier<=0){
            const pr=plRect();
            if(hit(e.x-e.w/2,e.y-e.h,e.w,e.h,pr.x,pr.y,pr.w,pr.h))plHit();
          }
          continue;
        }

        if(e.type==="worm"){
          // Worm stays in place, shoots up
          e.y=e.groundY-e.h;
          if(e.shootT<=0&&dist<320){
            e.shootT=e.shootCD;
            // Lob slime balls
            const dx=pl.x-e.x;
            spawnBul(e.x,e.y-e.h,dx>0?2:-2,-7,false);
          }
          if(e.shootT>0)e.shootT--;
          continue;
        }

        if(e.type==="spitter"){
          // Stationary spitter, aims
          e.y=e.groundY-e.h;
          if(dist>60)moveLeft(); // slowly advance
          if(e.shootT<=0&&dist<380){
            e.shootT=e.shootCD;
            const dx=pl.x-e.x,dy=(pl.y-14)-(e.y+e.h/2),mg=Math.hypot(dx,dy);
            spawnBul(e.x,e.y-e.h/2,(dx/mg)*5,(dy/mg)*5,false);
            if(e.burstN<2){e.burstN++;e.shootT=14;}else e.burstN=0;
          }
          if(e.shootT>0)e.shootT--;
          continue;
        }

        if(e.type==="bug"){
          e.flameT=Math.max(0,(e.flameT??0)-1);
          moveLeft();
          e.y=e.groundY-e.h;
          if(dist<90&&e.shootT<=0){
            e.shootT=35;e.flameT=18;
            for(let f=-1;f<=1;f++)spawnBul(e.x-10,e.y-10,-3.5+f*0.5,f*1.5,false);
          }
          if(e.shootT>0)e.shootT--;
          continue;
        }

        if(e.type==="crab"){
          // Advances left slowly
          if(dist>50)moveLeft();
          e.y=e.groundY-e.h;
          if(e.shootT<=0&&dist<280){
            e.shootT=e.shootCD;
            spawnBul(e.x-10,e.y-e.h/2,-4,0,false);
          }
          if(e.shootT>0)e.shootT--;
          continue;
        }

        // blob / spider — advance left, shoot
        moveLeft();
        e.y=e.groundY-e.h;
        if(e.shootT<=0&&dist<350){
          e.shootT=e.shootCD;
          const dx=pl.x-e.x,dy=(pl.y-14)-(e.y+e.h/2),mg=Math.hypot(dx,dy);
          spawnBul(e.x+(dx/mg)*12,e.y-e.h/2,(dx/mg)*4.5,(dy/mg)*4.5,false);
        }
        if(e.shootT>0)e.shootT--;

        // Contact damage
        if(!pl.dead&&pl.inv<=0&&pl.barrier<=0){
          const pr=plRect();
          if(hit(e.x-e.w/2,e.y-e.h,e.w,e.h,pr.x,pr.y,pr.w,pr.h))plHit();
        }
      }

      // ── BULLET vs ENEMY (world-space, no camera) ──────────────────────────
      for(const b2 of buls){
        if(b2.dead||!b2.pl)continue;
        for(const e of enemies){
          if(e.dead||e.hidden||e.emerging||e.spawnProtect>0)continue;
          // Hitbox: e.y is the TOP of body, e.y+e.h is feet. Add 8px padding.
          const ex2=e.x-e.w/2-8;
          const ey2=e.y-8;
          const ew=e.w+16;
          const eh=e.h+16;
          if(!hit(b2.x-4,b2.y-4,8,8,ex2,ey2,ew,eh))continue;

          e.hp-=b2.dmg;e.flashT=4;
          if(b2.wp!=="L"||b2.pierce<=0)b2.dead=true;else b2.pierce--;

          if(e.hp<=0){
            e.dead=true;
            pl.score+=e.type==="spider"||e.type==="crab"?200:e.type==="spitter"?300:100;
            sfxDie();
            burst(e.x,e.y-e.h/2,10,["#4ade80","#fbbf24","#ef4444","#a78bfa","#fff"],3.5);
            g.shakeX=2;g.shakeDur=5;
            if(Math.random()<0.2){const wps:Pick["type"][]=["S","L","F","R","B"];dropPick(e.x,e.y-e.h,wps[Math.floor(Math.random()*wps.length)]);}
          }
          break;
        }
      }
    }

    function updPicks(lv:LevelDef){
      for(let i=picks.length-1;i>=0;i--){
        const pk=picks[i];if(pk.dead){picks.splice(i,1);continue;}
        pk.timer--;pk.bob+=0.08;
        if(!pk.bounced){
          pk.vy+=0.35;pk.y+=pk.vy;
          if(pk.y>=GY-10){pk.y=GY-10;pk.vy=-3;pk.bounced=true;}
          for(const p of lv.plats)if(pk.y>=p.y&&pk.y<=p.y+p.h&&pk.x>p.x&&pk.x<p.x+p.w){pk.y=p.y;pk.vy=0;pk.bounced=true;}
        }
        if(pk.timer<=0)pk.dead=true;
      }
    }

    function updDrones(){
      droneT++;
      if(droneT>=(1300+Math.floor(Math.random()*300))){
        droneT=0;
        const wps:Weapon[]=["S","L","F","R"];
        drones.push({x:g.camX+CW+30,y:68+Math.random()*65,vx:-1.3,wp:wps[Math.floor(Math.random()*wps.length)],dead:false});
      }
      for(let i=drones.length-1;i>=0;i--){
        const d=drones[i];if(d.dead){drones.splice(i,1);continue;}
        d.x+=d.vx;
        if(d.x<g.camX-60){d.dead=true;continue;}
        for(const b2 of buls){
          if(b2.dead||!b2.pl)continue;
          if(hit(b2.x-5,b2.y-5,10,10,d.x-18,d.y-8,36,16)){
            b2.dead=true;d.dead=true;sfxExp();burst(d.x,d.y,10,["#ef4444","#fbbf24","#fff"],4);
            g.shakeX=3;g.shakeDur=6;dropPick(d.x,d.y,["S","L","F","R"][Math.floor(Math.random()*4)] as Pick["type"]);
            pl.score+=200;break;
          }
        }
      }
    }

    function updMovPlats(lv:LevelDef){
      for(const p of lv.plats){
        if(p.moving&&p.vx!=null){
          p.x+=p.vx;
          if(p.minX!=null&&p.maxX!=null&&(p.x<p.minX||p.x+p.w>p.maxX))p.vx*=-1;
        }
      }
    }

    //──── BOSS UPDATE ───────────────────────────────────────────────────────
    function updBoss(){
      if(!boss)return;
      const bs=boss;
      if(bs.state==="enter"){
        bs.x-=1.8;
        const tx=bs.world===3?g.camX+CW/2:g.camX+CW-130;
        if(bs.x<=tx){bs.state="fight";bs.x=tx;}
      }
      if(bs.state!=="fight")return;
      bs.timer++;if(bs.flashT>0)bs.flashT--;bs.atkT++;

      if(bs.world===1){
        bs.deployT--;
        if(bs.deployT<=0){bs.deployT=600;spawnEnemy(bs.x-30,"blob",GY,false);spawnEnemy(bs.x+bs.w+10,"blob",GY,false);}
        if(bs.atkT%88===0){const dx=pl.x-bs.x,dy=pl.y-bs.y,mg=Math.hypot(dx,dy);spawnBul(bs.x+bs.w/2,bs.y-10,(dx/mg)*5,(dy/mg)*5-2.5,false);}
        if(bs.atkT%125===0){spawnBul(bs.x-10,bs.y+28,-3.5,0.5,false);spawnBul(bs.x+bs.w+5,bs.y+28,3.5,0.5,false);}
        const cx=bs.x+bs.w/2,cy=bs.y+bs.h/2-10;
        for(const bl of buls){
          if(bl.dead||!bl.pl)continue;
          if(Math.hypot(bl.x-cx,bl.y-cy)<17){bl.dead=true;bs.hp--;bs.flashT=4;g.shakeX=4;g.shakeDur=8;sfxExp();burst(cx,cy,6,["#f97316","#ef4444","#fbbf24"],3);if(bs.hp<=0)bossKill();break;}
        }
      } else if(bs.world===2){
        const allDead=bs.eyes?.every(e=>e.dead&&e.regenC>=2);
        bs.coreExp=allDead??false;
        bs.eyes?.forEach(eye=>{
          if(eye.dead){eye.regen++;if(eye.regen>280&&eye.regenC<2){eye.dead=false;eye.hp=2;eye.regenC++;eye.regen=0;}return;}
          if(bs.atkT%58===0){const ex2=bs.x+eye.x,ey2=bs.y+eye.y,dx=pl.x-ex2,dy=pl.y-ey2,mg=Math.hypot(dx,dy);spawnBul(ex2,ey2,(dx/mg)*4,(dy/mg)*4,false);}
          const ex2=bs.x+eye.x,ey2=bs.y+eye.y;
          for(const bl of buls){if(bl.dead||!bl.pl)continue;if(Math.hypot(bl.x-ex2,bl.y-ey2)<18){bl.dead=true;eye.hp--;if(eye.hp<=0){eye.dead=true;sfxExp();burst(ex2,ey2,8,["#ef4444","#fbbf24","#a855f7"],4);pl.score+=300;}break;}}
        });
        if(bs.coreExp)for(const bl of buls){if(bl.dead||!bl.pl)continue;if(Math.hypot(bl.x-bs.x,bl.y-bs.y)<22){bl.dead=true;bs.hp--;bs.flashT=4;sfxExp();burst(bs.x,bs.y,6,["#f0abfc","#ef4444","#fff"],3);g.shakeX=3;g.shakeDur=6;if(bs.hp<=0)bossKill();break;}}
      } else {
        bs.phase=Math.floor((bs.maxHp-bs.hp)/6);
        if(bs.atkT%62===0){for(let a=-24;a<=24;a+=12){const r2=Math.PI+(a*Math.PI/180);spawnBul(bs.x-bs.w/2,bs.y+20,Math.cos(r2)*4,Math.sin(r2)*4,false);}}
        if(bs.phase>=1&&bs.atkT%95===0){const dx=pl.x-bs.x,dy=pl.y-bs.y,mg=Math.hypot(dx,dy);spawnBul(bs.x-bs.w/2,bs.y,(dx/mg)*4.5,(dy/mg)*4.5,false);}
        if(bs.phase>=2){if(bs.atkT%175===0){bs.laserOn=true;bs.laserT=55;}if(bs.laserT>0){bs.laserT--;if(bs.laserT<=0)bs.laserOn=false;if(bs.laserOn&&bs.atkT%8===0){const pr=plRect();if(pr.y<=bs.y+36&&pr.y+pr.h>=bs.y+24)plHit();}}}
        for(const bl of buls){if(bl.dead||!bl.pl)continue;if(hit(bl.x-5,bl.y-5,10,10,bs.x-bs.w/2,bs.y-bs.h/2,bs.w,bs.h)){bl.dead=true;bs.hp--;bs.flashT=4;sfxExp();burst(bl.x,bl.y,5,["#ef4444","#f97316","#fbbf24"],3);g.shakeX=4;g.shakeDur=8;if(bs.hp<=0)bossKill();break;}}
      }
    }
    function bossKill(){
      if(!boss)return;boss.state="dead";boss.dead=true;
      sfxBigExp();g.flashA=1;g.shakeX=8;g.shakeDur=28;pl.score+=5000;
      for(let i=0;i<6;i++)setTimeout(()=>{if(!boss)return;burst(boss.x+(Math.random()-.5)*boss.w,boss.y+(Math.random()-.5)*boss.h,14,["#f97316","#fbbf24","#ef4444","#fff"],6);sfxBigExp();},i*170);
      setTimeout(()=>{
        boss=null;pl.hi=Math.max(pl.hi,pl.score);try{localStorage.setItem("ph",String(pl.hi));}catch(_){}
        if(g.world>=2){g.phase="win";g.winT=0;g.winParX=-40;mOn=true;}
        else{g.phase="wclear";g.wclearT=0;}
      },1400);
    }

    //──── GAME FLOW ─────────────────────────────────────────────────────────
    function startGame(){
      try{pl.hi=parseInt(localStorage.getItem("ph")||"0");}catch(_){}
      g.world=0;g.phase="intro";g.introT=0;g.camX=0;
      g.spawned=new Array(levels[0].spawns.length).fill(false);
      pl.x=100;pl.y=GY;pl.vx=0;pl.vy=0;pl.dead=false;pl.inv=0;
      pl.barrier=0;pl.rapid=0;pl.bombs=0;pl.wp="M";pl.lives=3;pl.score=0;
      pl.onGrd=false;pl.prone=false;pl.dir=1;pl.aimUp=false;pl.aimDiag=false;
      enemies.length=0;buls.length=0;picks.length=0;drones.length=0;pars.length=0;boss=null;droneT=0;mOn=true;mBeat=0;
      preSpawnAll(levels[0]);
    }
    function continueGame(){
      g.phase="intro";g.introT=0;g.camX=0;
      pl.x=100;pl.y=GY;pl.vx=0;pl.vy=0;pl.dead=false;pl.inv=60;pl.wp="M";pl.lives=3;
      pl.barrier=0;pl.rapid=0;pl.bombs=0;pl.onGrd=false;pl.prone=false;pl.dir=1;
      enemies.length=0;buls.length=0;picks.length=0;drones.length=0;boss=null;droneT=0;mOn=true;
      g.spawned=new Array(levels[g.world]?.spawns.length||0).fill(false);
      const lv=levels[g.world];if(lv)preSpawnAll(lv);
    }
    function fullReset(){pl.score=0;startGame();}

    //──── OVERLAY SCREENS ───────────────────────────────────────────────────
    function drawTitle(frame:number){
      ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);
      for(let i=0;i<55;i++){ctx.fillStyle=`rgba(255,255,255,${0.15+Math.sin(frame*0.04+i)*0.12})`;ctx.fillRect((i*137+Math.floor(frame*0.4))%CW,(i*83)%180,2,2);}
      ctx.fillStyle="#dc2626";ctx.font='26px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText("CONTRA",CW/2,65);
      ctx.fillStyle="#f97316";ctx.font='8px "Press Start 2P",monospace';ctx.fillText("— SQUAD EDITION —",CW/2,83);
      // Side-view parrot on title
      ctx.save();ctx.translate(CW/2-12,210);ctx.scale(2.2,2.2);
      drawParrot(Math.floor(frame/10)%2===0?"stand":"run",frame,false);
      ctx.restore();
      if(Math.floor(frame/26)%2===0){ctx.fillStyle="#fff";ctx.font='7px "Press Start 2P",monospace';ctx.fillText("PRESS SPACE / TAP TO START",CW/2,278);}
      ctx.fillStyle="#fbbf24";ctx.font='6px "Press Start 2P",monospace';ctx.fillText(`HI-SCORE  ${String(pl.hi).padStart(7,"0")}`,CW/2,300);
      ctx.fillStyle="#6b7280";ctx.font='5px "Press Start 2P",monospace';
      ctx.fillText("ARROWS:MOVE+AIM  SPACE:JUMP  X:SHOOT  Z:BOMB  P:PAUSE",CW/2,330);
      ctx.fillText("UP=AIM UP  UP+DIR=DIAGONAL  DOWN(GND)=CROUCH",CW/2,344);
      ctx.textAlign="left";
    }
    function drawIntro(){
      ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);
      const names=["JUNGLE","MILITARY BASE","ALIEN LAIR"];
      ctx.fillStyle="#fff";ctx.font='13px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText(`AREA ${g.world+1}`,CW/2,CH/2-14);
      ctx.fillStyle="#9ca3af";ctx.font='8px "Press Start 2P",monospace';ctx.fillText(names[g.world]||"",CW/2,CH/2+10);
      ctx.textAlign="left";
    }
    function drawWarn(){
      if(Math.floor(g.warnT/11)%2===0){ctx.fillStyle="rgba(180,0,0,0.55)";ctx.fillRect(0,0,CW,CH);ctx.fillStyle="#ef4444";ctx.font='20px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText("!! WARNING !!",CW/2,CH/2);ctx.textAlign="left";}
      else{ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);}
    }
    function drawClear(){ctx.fillStyle="rgba(0,0,0,0.55)";ctx.fillRect(0,0,CW,CH);ctx.fillStyle="#fbbf24";ctx.font='12px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText("MISSION COMPLETE!",CW/2,CH/2-14);ctx.fillStyle="#fff";ctx.font='7px "Press Start 2P",monospace';ctx.fillText(`SCORE ${String(pl.score).padStart(7,"0")}`,CW/2,CH/2+10);ctx.textAlign="left";}
    function drawWClear(){ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);const msgs=["THE JUNGLE BASE HAS BEEN DESTROYED!","THE MILITARY BASE HAS FALLEN!"];ctx.fillStyle="#fbbf24";ctx.font='8px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText(msgs[g.world-1]||"VICTORY!",CW/2,CH/2);ctx.textAlign="left";}
    function drawOver(){
      ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);
      ctx.fillStyle="#dc2626";ctx.font='18px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText("GAME OVER",CW/2,CH/2-42);
      ctx.fillStyle="#fff";ctx.font='7px "Press Start 2P",monospace';ctx.fillText(`SCORE ${String(pl.score).padStart(7,"0")}`,CW/2,CH/2-14);
      ctx.fillStyle="#fbbf24";ctx.fillText(`HI    ${String(pl.hi).padStart(7,"0")}`,CW/2,CH/2+4);
      if(g.contCount>0){if(Math.floor(g.overT/13)%2===0){ctx.fillStyle="#f97316";ctx.fillText(`CONTINUE? ${g.contCount}`,CW/2,CH/2+30);ctx.fillStyle="#9ca3af";ctx.font='5px "Press Start 2P",monospace';ctx.fillText("PRESS SPACE / TAP",CW/2,CH/2+48);}}
      else{if(Math.floor(g.overT/20)%2===0){ctx.fillStyle="#fff";ctx.fillText("PRESS SPACE TO RETRY",CW/2,CH/2+30);}}
      ctx.textAlign="left";
    }
    function drawWin(frame:number){
      ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);
      for(let i=0;i<80;i++){ctx.fillStyle=`rgba(255,255,255,${0.15+Math.sin(frame*0.05+i)*0.12})`;ctx.fillRect((i*137+Math.floor(frame*0.5))%CW,(i*97)%(CH-80),2,2);}
      ctx.fillStyle="#fbbf24";ctx.font='16px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText("YOU WIN!",CW/2,80);
      ctx.fillStyle="#ff69b4";ctx.font='7px "Press Start 2P",monospace';ctx.fillText("RED FALCON DEFEATED!",CW/2,105);
      ctx.save();ctx.translate(g.winParX,CH/2-18);ctx.scale(2,2);drawParrot("jump",frame,false);ctx.restore();
      ctx.fillStyle="#fff";ctx.font='6px "Press Start 2P",monospace';
      ctx.fillText(`FINAL SCORE  ${String(pl.score).padStart(7,"0")}`,CW/2,CH-72);
      ctx.fillText(`HI-SCORE     ${String(pl.hi).padStart(7,"0")}`,CW/2,CH-58);
      ctx.textAlign="left";
    }

    //──── MAIN LOOP ─────────────────────────────────────────────────────────
    let frame=0,lastT=0,rafId=0;
    g.phase="title";
    try{pl.hi=parseInt(localStorage.getItem("ph")||"0");}catch(_){}

    function loop(ts:number){
      rafId=requestAnimationFrame(loop);
      const dt=Math.min(ts-lastT,50);lastT=ts;frame++;
      dtS=dt/16.67;
      if(g.shakeDur>0){g.shakeDur--;g.shakeX=(Math.random()-.5)*5;g.shakeY=(Math.random()-.5)*5;}else{g.shakeX=0;g.shakeY=0;}
      ctx.save();ctx.translate(g.shakeX,g.shakeY);

      // Simple phase routing
      if(g.phase==="title"){drawTitle(frame);ctx.restore();return;}
      if(g.phase==="intro"){drawIntro();g.introT++;if(g.introT>105){g.phase="play";droneT=0;}ctx.restore();return;}
      if(g.phase==="bwarn"){drawWarn();g.warnT++;if(g.warnT>=84){g.phase="boss";spawnBoss(g.world+1);}ctx.restore();return;}
      if(g.phase==="over"){drawOver();g.overT++;g.contT++;if(g.contT>=60&&g.contCount>0){g.contT=0;g.contCount--;}ctx.restore();return;}
      if(g.phase==="win"){g.winT++;g.winParX+=1.6;if(g.winParX>CW+60)g.winParX=-60;drawWin(frame);ctx.restore();return;}
      if(g.phase==="wclear"){drawWClear();g.wclearT++;if(g.wclearT>210){g.world++;g.phase="intro";g.introT=0;g.camX=0;pl.x=100;pl.y=GY;pl.dead=false;pl.inv=60;enemies.length=0;buls.length=0;picks.length=0;drones.length=0;boss=null;droneT=0;mOn=true;g.spawned=new Array(levels[g.world]?.spawns.length||0).fill(false);const nextLv=levels[g.world];if(nextLv)preSpawnAll(nextLv);}ctx.restore();return;}
      if(g.phase==="clear"){
        const lv2=levels[g.world];
        drawBG(lv2,g.camX,frame);drawGround(lv2,g.camX,frame);drawPlats(lv2,g.camX);
        drawClear();g.clearT++;if(g.clearT>145){g.phase="bwarn";g.warnT=0;mOn=false;tone(60,"sine",2,0.28);}
        ctx.restore();return;
      }
      if(paused){ctx.fillStyle="rgba(0,0,0,0.55)";ctx.fillRect(0,0,CW,CH);ctx.fillStyle="#fff";ctx.font='12px "Press Start 2P",monospace';ctx.textAlign="center";ctx.fillText("PAUSED",CW/2,CH/2);ctx.textAlign="left";ctx.restore();return;}

      const lv=levels[g.world];if(!lv){ctx.restore();return;}

      // Update
      if(g.phase==="play"){
        tickM(lv.bpm);
        if(!pl.dead){const tx=pl.x-200;g.camX+=(tx-g.camX)*0.12;g.camX=Math.max(0,Math.min(lv.length-CW,g.camX));}
        updMovPlats(lv);updPlayer(lv);updBuls(lv);updEnemies(lv);updPicks(lv);updDrones();
        if(g.camX>=lv.length-CW-5&&!boss&&g.phase==="play"){g.phase="clear";g.clearT=0;}
      } else if(g.phase==="boss"){
        tickM(lv.bpm+30);updMovPlats(lv);updPlayer(lv);updBuls(lv);updEnemies(lv);updPicks(lv);if(boss)updBoss();
      }

      // Particles
      for(let i=pars.length-1;i>=0;i--){const p=pars[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.14;p.vx*=0.98;p.life--;if(p.life<=0)pars.splice(i,1);}

      //── RENDER ──
      drawBG(lv,g.camX,frame);
      drawGround(lv,g.camX,frame);
      drawBushes(lv,g.camX);   // bushes in front of ground (hiding spots)
      drawPlats(lv,g.camX);

      // Pickups
      for(const pk of picks)drawPick(pk,g.camX);
      // Drones
      for(const d of drones)drawDrone(d,g.camX);

      // Enemies (only non-hidden)
      for(const e of enemies){if(!e.dead&&!e.hidden)drawEnemy(e,e.x-g.camX);}

      // Boss
      if(boss&&!boss.dead)drawBoss(boss,g.camX);

      // Bullets
      for(const b2 of buls){
        if(b2.dead)continue;
        const bsx=b2.x-g.camX;
        if(bsx<-30||bsx>CW+30)continue;
        if(b2.wp==="L"){
          const ld=b2.vx>0?1:b2.vx<0?-1:(b2.vy>0?0:0);
          ctx.fillStyle="#67e8f9";
          if(ld!==0)ctx.fillRect(bsx,b2.y-2,ld*(CW+100),5);else ctx.fillRect(bsx-4,b2.y,8,b2.vy>0?200:-200);
          ctx.fillStyle="rgba(103,232,249,0.25)";
          if(ld!==0)ctx.fillRect(bsx,b2.y-6,ld*(CW+100),14);
        } else if(b2.wp==="F"){
          ctx.fillStyle=`hsl(${20+Math.sin(frame*0.3)*20},100%,60%)`;
          ctx.fillRect(bsx-4,b2.y-4,8,8);
          ctx.fillStyle="rgba(255,120,0,0.35)";ctx.fillRect(bsx-7,b2.y-7,14,14);
        } else if(b2.wp==="S"){
          ctx.fillStyle="#fb923c";ctx.fillRect(bsx-3,b2.y-3,6,6);
        } else {
          if(b2.pl){
            const bw=b2.wp==="R"?10:8;
            ctx.fillStyle="#fef08a";ctx.fillRect(bsx-(b2.vx>0?0:bw),b2.y-2,bw,4);
            ctx.fillStyle="#fbbf24";ctx.fillRect(bsx-(b2.vx>0?0:bw)+1,b2.y,bw-2,1);
          } else {
            ctx.fillStyle="#f87171";ctx.fillRect(bsx-4,b2.y-2,8,4);
          }
        }
      }

      // Barrier
      if(pl.barrier>0&&!pl.dead){
        const bl=pl.barrier<120&&Math.floor(pl.barrier/7)%2===0;
        if(!bl){ctx.strokeStyle=`rgba(103,232,249,${0.5+Math.sin(frame*0.22)*0.28})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(pl.x-g.camX,pl.y-pl.h/2,24,0,Math.PI*2);ctx.stroke();}
      }

      // Player
      if(!pl.dead||pl.deadT>50){
        const psx=pl.x-g.camX;
        ctx.save();ctx.translate(psx,pl.y);
        if(pl.dir<0)ctx.scale(-1,1);
        const show=!(pl.inv>0&&Math.floor(pl.inv/4)%2===0);
        if(show){
          let st:"stand"|"run"|"jump"|"prone"|"dead"|"up"|"diag"="stand";
          if(pl.dead)st="dead";
          else if(pl.prone)st="prone";
          else if(!pl.onGrd)st=pl.aimUp?"up":"jump";
          else if(Math.abs(pl.vx)>0.5)st=pl.aimDiag?"diag":pl.aimUp?"up":"run";
          else st=pl.aimDiag?"diag":pl.aimUp?"up":"stand";
          drawParrot(st,pl.animF,pl.flash>0);
        }
        ctx.restore();
      }

      // Particles
      for(const p of pars){const psx=p.x-g.camX;if(psx<-12||psx>CW+12)continue;ctx.globalAlpha=p.life/p.ml;ctx.fillStyle=p.col;ctx.fillRect(psx,p.y,p.sz,p.sz);}
      ctx.globalAlpha=1;

      drawHUD();
      if(g.phase==="boss"&&boss)drawBossHUD(boss);
      if("ontouchstart" in window)drawTouchUI();
      if(g.flashA>0){ctx.fillStyle=`rgba(255,255,255,${g.flashA})`;ctx.fillRect(0,0,CW,CH);g.flashA=Math.max(0,g.flashA-0.052);}
      drawScanlines();
      ctx.restore();
    }

    lastT=performance.now();rafId=requestAnimationFrame(loop);
    return()=>{cancelAnimationFrame(rafId);document.removeEventListener("keydown",kd);document.removeEventListener("keyup",ku);};
  },[]);

  const [showRotate, setShowRotate] = useState(false);
  useEffect(()=>{
    const isMobile="ontouchstart" in window||navigator.maxTouchPoints>0;
    if(!isMobile)return;
    const check=()=>setShowRotate(window.innerWidth<window.innerHeight);
    check();
    window.addEventListener("resize",check);
    window.addEventListener("orientationchange",check);
    return()=>{window.removeEventListener("resize",check);window.removeEventListener("orientationchange",check);};
  },[]);

  return(
    <div style={{width:"100vw",height:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
      <canvas ref={cv} width={CW} height={CH} style={{
        imageRendering:"pixelated",
        width:`min(100vw, calc(100vh * ${CW} / ${CH}))`,
        height:`min(100vh, calc(100vw * ${CH} / ${CW}))`,
      }}/>
      {showRotate&&(
        <div style={{position:"fixed",inset:0,background:"#000",zIndex:9999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:32,padding:24}}>
          <div style={{animation:"spin 2s ease-in-out infinite",fontSize:72,lineHeight:1}}>📱</div>
          <p style={{fontFamily:'"Press Start 2P",monospace',color:"#f97316",fontSize:13,textAlign:"center",lineHeight:2}}>
            ROTATE YOUR<br/>DEVICE
          </p>
          <p style={{fontFamily:'"Press Start 2P",monospace',color:"#6b7280",fontSize:7,textAlign:"center",lineHeight:2}}>
            THIS GAME REQUIRES<br/>LANDSCAPE MODE
          </p>
          <style>{`
            @keyframes spin{
              0%{transform:rotate(0deg);}
              40%{transform:rotate(-90deg);}
              60%{transform:rotate(-90deg);}
              100%{transform:rotate(-90deg) scale(1.08);}
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
