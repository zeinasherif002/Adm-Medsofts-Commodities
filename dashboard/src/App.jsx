import { useState, useEffect } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E";
const HEADERS = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
const COMMODITIES = [
  { id: "corn", label: "Corn", icon: "" },
  { id: "wheat", label: "Wheat", icon: "" },
  { id: "soybeans", label: "Soybeans", icon: "" },
];

const C = {
  gold: "#38bdf8",
  goldDim: "#0ea5e9",
  green: "#34d399",
  greenDim: "#10b981",
  red: "#f87171",
  redDim: "#ef4444",
  blue: "#818cf8",
  purple: "#a78bfa",
  cyan: "#67e8f9",
  bg: "#080810",
  sidebar: "#0c0c18",
  card: "#10101e",
  cardBorder: "#1c1c32",
  text: "#e2e8f0",
  textSub: "#64748b",
  textMuted: "#334155",
  chartGrid: "#13132a",
};

function fmt(n, d) { if (d === undefined) d = 2; return Number(n).toFixed(d); }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : fmt(n); }

function calcMA(prices, period) {
  return prices.map(function(_, i) {
    if (i < period - 1) return null;
    var s = prices.slice(i - period + 1, i + 1);
    return s.reduce(function(a, b) { return a + b; }, 0) / period;
  });
}
function calcRSI(prices, period) {
  if (!period) period = 14;
  var rsi = new Array(prices.length).fill(null);
  for (var i = period; i < prices.length; i++) {
    var g = 0, l = 0;
    for (var j = i - period + 1; j <= i; j++) { var d = prices[j] - prices[j-1]; if (d > 0) g += d; else l -= d; }
    var ag = g/period, al = l/period;
    rsi[i] = al === 0 ? 100 : 100 - (100 / (1 + ag/al));
  }
  return rsi;
}
function calcBollinger(prices, period, mult) {
  if (!period) period = 20; if (!mult) mult = 2;
  return prices.map(function(_, i) {
    if (i < period - 1) return { upper: null, lower: null };
    var s = prices.slice(i - period + 1, i + 1);
    var mean = s.reduce(function(a,b){return a+b;},0)/period;
    var std = Math.sqrt(s.reduce(function(a,b){return a+Math.pow(b-mean,2);},0)/period);
    return { upper: mean + mult*std, lower: mean - mult*std };
  });
}
function calcEMA(prices, period) {
  var k = 2/(period+1), ema = new Array(prices.length).fill(null), fv = -1;
  for (var i = 0; i < prices.length; i++) { if (prices[i] !== null) { fv = i; break; } }
  if (fv === -1) return ema;
  ema[fv] = prices[fv];
  for (var i = fv+1; i < prices.length; i++) ema[i] = prices[i] === null ? ema[i-1] : prices[i]*k + ema[i-1]*(1-k);
  return ema;
}
function calcMACD(prices) {
  var e12=calcEMA(prices,12), e26=calcEMA(prices,26);
  var ml=prices.map(function(_,i){return (e12[i]===null||e26[i]===null)?null:e12[i]-e26[i];});
  var sl=calcEMA(ml.filter(function(v){return v!==null;}),9);
  var res=new Array(prices.length).fill(null), ni=0;
  ml.forEach(function(v,i){
    if(v!==null){res[i]={macd:v,signal:sl[ni]||null,histogram:sl[ni]!==null?v-sl[ni]:null};ni++;}
    else res[i]={macd:null,signal:null,histogram:null};
  });
  return res;
}
function calcSR(prices) {
  var s=prices.slice().sort(function(a,b){return a-b;});
  return {support:s[Math.floor(s.length*0.1)],resistance:s[Math.floor(s.length*0.9)]};
}
function calcZScore(prices) {
  var mean=prices.reduce(function(a,b){return a+b;},0)/prices.length;
  var std=Math.sqrt(prices.reduce(function(a,b){return a+Math.pow(b-mean,2);},0)/prices.length);
  return std===0?0:(prices[prices.length-1]-mean)/std;
}
function getTrend(prices) {
  if(prices.length<5)return "neutral";
  var r=prices.slice(-5), pct=(r[r.length-1]-r[0])/r[0]*100;
  return pct>1?"bullish":pct<-1?"bearish":"neutral";
}

function Tooltip2(props) {
  var active=props.active, payload=props.payload, label=props.label;
  if(!active||!payload||!payload.length)return null;
  return (
    <div style={{background:"#0d0d16",border:"1px solid #1a1a2e",borderRadius:8,padding:"10px 14px",fontSize:11,boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>
      <p style={{color:T.accent,marginBottom:5,fontWeight:700,fontFamily:"monospace"}}>{label}</p>
      {payload.map(function(p,i){
        if(p.value===null||p.value===undefined)return null;
        return <p key={i} style={{color:p.color,margin:"2px 0",fontFamily:"monospace"}}>{p.name}: <strong>{typeof p.value==="number"?p.value.toFixed(2):p.value}</strong></p>;
      })}
    </div>
  );
}

function KpiCard(props) {
  var label=props.label,value=props.value,unit=props.unit,accentColor=props.accentColor,delta=props.delta,pct=props.pct,mape=props.mape;
  var isUp = delta !== undefined && delta >= 0;
  var deltaColor = delta === undefined ? colors.textSub : delta > 0 ? colors.green : delta < 0 ? colors.red : colors.textSub;
  return (
    <div style={{background:colors.card,border:"1px solid "+colors.cardBorder,borderRadius:12,padding:"16px 18px",borderTop:"2px solid "+accentColor,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,right:0,width:60,height:60,borderRadius:"0 12px 0 100%",background:accentColor,opacity:0.07}}/>
      <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",color:colors.textSub,marginBottom:8}}>{label}</div>
      <div style={{fontSize:24,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:"-0.5px",lineHeight:1}}>{value}</div>
      <div style={{fontSize:11,color:colors.textMuted,marginTop:3,marginBottom:8,fontFamily:"monospace"}}>{unit}</div>
      {delta !== undefined && (
        <div style={{fontSize:11,fontWeight:700,color:deltaColor,fontFamily:"monospace"}}>
          {delta>0?"+":delta<0?"-":""} {fmt(Math.abs(delta))}{pct!==undefined?" ("+fmt(Math.abs(pct))+"%)":""}
        </div>
      )}
      {mape !== undefined && (
        <div style={{fontSize:10,color:mape!==null?(mape<2?colors.green:mape<5?colors.accent:colors.red):colors.textMuted,marginTop:4,fontFamily:"monospace"}}>
          MAPE: {mape!==null?mape.toFixed(2)+"%":"accumulating..."}
        </div>
      )}
    </div>
  );
}

export default function App() {
  var [commodity,setCommodity]=useState("corn");
  var [data,setData]=useState([]);
  var [loading,setLoading]=useState(true);
  var [activeTab,setActiveTab]=useState("overview");
  var [lastUpdated,setLastUpdated]=useState(null);
  var [aiAnalysis,setAiAnalysis]=useState("");
  var [aiLoading,setAiLoading]=useState(false);
  var [dark,setDark]=useState(true);

  function loadData(c) {
    setLoading(true);
    fetch(SUPABASE_URL+"/rest/v1/commodity_prices?commodity=eq."+c+"&order=date.desc&limit=60",{headers:HEADERS})
      .then(function(r){return r.json();})
      .then(function(rows){setData(rows);setLastUpdated(new Date());setLoading(false);})
      .catch(function(e){console.error(e);setLoading(false);});
  }

  useEffect(function(){
    loadData(commodity);
    var iv=setInterval(function(){loadData(commodity);},5*60*1000);
    return function(){clearInterval(iv);};
  },[commodity]);

  var T = dark ? {
    bg:"#080810", sidebar:"#0c0c18", card:"#10101e", cardBorder:"#1c1c32",
    text:"#e2e8f0", textSub:"#64748b", textMuted:"#334155", chartGrid:"#13132a",
    accent:"#38bdf8", green:"#34d399", red:"#f87171", blue:"#818cf8", purple:"#a78bfa", cyan:"#67e8f9",
  } : {
    bg:"#f8fafc", sidebar:"#ffffff", card:"#ffffff", cardBorder:"#e2e8f0",
    text:"#0f172a", textSub:"#64748b", textMuted:"#94a3b8", chartGrid:"#f1f5f9",
    accent:"#0ea5e9", green:"#059669", red:"#dc2626", blue:"#6366f1", purple:"#7c3aed", cyan:"#0891b2",
  };

  var latest=data[0],prev=data[1];
  var cbotDelta=latest&&prev?latest.closing_cbot-prev.closing_cbot:0;
  var cbotPct=prev&&prev.closing_cbot?(cbotDelta/prev.closing_cbot)*100:0;
  var argDelta=latest&&prev?latest.arg_price-prev.arg_price:0;
  var alertActive=Math.abs(cbotPct)>=2;

  var prices=data.slice().reverse().map(function(d){return d.closing_cbot;});
  var dates=data.slice().reverse().map(function(d){return d.date?d.date.slice(5):"";});
  var argPrices=data.slice().reverse().map(function(d){return d.arg_price;});

  var ma7=calcMA(prices,7),ma21=calcMA(prices,21);
  var rsiArr=calcRSI(prices,14);
  var bollArr=calcBollinger(prices,20,2);
  var macdArr=calcMACD(prices);
  var srLevels=calcSR(prices);
  var zScore=calcZScore(prices);
  var trend=getTrend(prices);

  var currentRSI=rsiArr[rsiArr.length-1];
  var currentMACD=macdArr[macdArr.length-1];
  var currentBoll=bollArr[bollArr.length-1];

  var rsiSignal=currentRSI!==null?(currentRSI<30?"BUY":currentRSI>70?"SELL":"HOLD"):"HOLD";
  var macdSignal=currentMACD&&currentMACD.macd!==null&&currentMACD.signal!==null?(currentMACD.macd>currentMACD.signal?"BUY":"SELL"):"HOLD";
  var trendSignal=trend==="bullish"?"BUY":trend==="bearish"?"SELL":"HOLD";
  var buyCount=[rsiSignal,macdSignal,trendSignal].filter(function(s){return s==="BUY";}).length;
  var sellCount=[rsiSignal,macdSignal,trendSignal].filter(function(s){return s==="SELL";}).length;
  var overallSignal=buyCount>=2?"BUY":sellCount>=2?"SELL":"HOLD";

  var chartData=dates.map(function(date,i){
    return {
      date:date,
      close:prices[i]!==undefined?parseFloat(prices[i].toFixed(2)):null,
      ma7:ma7[i]!==null?parseFloat(ma7[i].toFixed(2)):null,
      ma21:ma21[i]!==null?parseFloat(ma21[i].toFixed(2)):null,
      upper:bollArr[i].upper!==null?parseFloat(bollArr[i].upper.toFixed(2)):null,
      lower:bollArr[i].lower!==null?parseFloat(bollArr[i].lower.toFixed(2)):null,
      rsi:rsiArr[i]!==null?parseFloat(rsiArr[i].toFixed(2)):null,
      histogram:macdArr[i].histogram!==null?parseFloat(macdArr[i].histogram.toFixed(4)):null,
      arg:argPrices[i]?Math.round(argPrices[i]):null,
      ret:data[data.length-1-i]&&data[data.length-1-i].fut_ret?parseFloat((data[data.length-1-i].fut_ret*100).toFixed(2)):null,
    };
  });

  function runAIAnalysis(){
    setAiLoading(true);setAiAnalysis("");setActiveTab("analysis");
    setTimeout(function(){setAiAnalysis(generateReport());setAiLoading(false);},800);
  }

  function generateReport(){
    if(!latest||prices.length<5)return "Not enough data.";
    var lines=[],cbot=latest.closing_cbot,prev5=prices.slice(-6,-1);
    var pct5=((cbot-prev5[0])/prev5[0]*100);
    lines.push("═══════════════════════════════════════");
    lines.push("  PRICE SUMMARY — "+latest.date);
    lines.push("═══════════════════════════════════════");
    if(cbotDelta>0)lines.push("+ UP "+Math.abs(cbotDelta).toFixed(2)+" ("+Math.abs(cbotPct).toFixed(2)+"%) — closed at "+cbot.toFixed(2)+" ¢/bu");
    else if(cbotDelta<0)lines.push("- DOWN "+Math.abs(cbotDelta).toFixed(2)+" ("+Math.abs(cbotPct).toFixed(2)+"%) — closed at "+cbot.toFixed(2)+" ¢/bu");
    else lines.push("→ FLAT — closed at "+cbot.toFixed(2)+" ¢/bu");
    lines.push("5-session: "+(pct5>=0?"+":"")+pct5.toFixed(2)+"% — "+(pct5>2?"sustained uptrend.":pct5<-2?"sustained selling.":"consolidating."));
    lines.push("");
    lines.push("───────────────────────────────────────");
    lines.push("  TECHNICAL INDICATORS");
    lines.push("───────────────────────────────────────");
    if(currentRSI!==null){
      var r="RSI(14) = "+currentRSI.toFixed(1)+" → ";
      if(currentRSI<30)r+="OVERSOLD — bounce potential.";
      else if(currentRSI<45)r+="Bearish zone.";
      else if(currentRSI<55)r+="Neutral.";
      else if(currentRSI<70)r+="Bullish zone.";
      else r+="OVERBOUGHT — pullback risk.";
      lines.push(r);
    }
    if(currentMACD&&currentMACD.histogram!==null)
      lines.push("MACD = "+currentMACD.histogram.toFixed(4)+" → "+(currentMACD.histogram>0?"Bullish momentum.":"Bearish momentum."));
    if(currentBoll&&currentBoll.upper!==null)
      lines.push("Bollinger → "+(cbot>currentBoll.upper?"Above upper band — overbought.":cbot<currentBoll.lower?"Below lower band — oversold.":"Inside band. Normal volatility."));
    lines.push("Z-Score = "+zScore.toFixed(2)+(Math.abs(zScore)>2?" → ⚠ EXTREME move!":" → Normal range."));
    var ma7v=ma7[ma7.length-1],ma21v=ma21[ma21.length-1];
    if(ma7v&&ma21v)lines.push("MA7="+ma7v.toFixed(2)+" | MA21="+ma21v.toFixed(2)+" → "+(ma7v>ma21v?"Bullish alignment.":"Bearish alignment."));
    lines.push("");
    lines.push("───────────────────────────────────────");
    lines.push("  KEY LEVELS");
    lines.push("───────────────────────────────────────");
    lines.push("Support:    "+srLevels.support.toFixed(2)+" ¢/bu");
    lines.push("Resistance: "+srLevels.resistance.toFixed(2)+" ¢/bu");
    lines.push("Price is "+((cbot-srLevels.support)/srLevels.support*100).toFixed(1)+"% above support.");
    lines.push("Price is "+((srLevels.resistance-cbot)/cbot*100).toFixed(1)+"% below resistance.");
    lines.push("");
    lines.push("───────────────────────────────────────");
    lines.push("  LOCAL MARKET (EGP)");
    lines.push("───────────────────────────────────────");
    lines.push("Dollar Rate: "+latest.dollar_rate.toFixed(2)+" EGP/USD");
    lines.push("ARG Price:   "+Math.round(latest.arg_price).toLocaleString()+" EGP");
    lines.push("BRZ Price:   "+Math.round(latest.brz_price).toLocaleString()+" EGP");
    if(argDelta>0)lines.push("ARG + "+Math.abs(argDelta).toFixed(0)+" EGP — higher cost for buyers.");
    else if(argDelta<0)lines.push("ARG - "+Math.abs(argDelta).toFixed(0)+" EGP — relief for buyers.");
    lines.push("");
    lines.push("═══════════════════════════════════════");
    lines.push("  SIGNAL: "+overallSignal+" ("+buyCount+"B / "+sellCount+"S)");
    lines.push("═══════════════════════════════════════");
    if(overallSignal==="BUY")lines.push("Bullish bias. Watch resistance: "+srLevels.resistance.toFixed(2)+".");
    else if(overallSignal==="SELL")lines.push("Bearish bias. Watch support: "+srLevels.support.toFixed(2)+".");
    else lines.push("Mixed signals — wait for clear breakout.");
    lines.push("\nAdmMedSofts Commodity Intelligence");
    return lines.join("\n");
  }

  var cc=COMMODITIES.find(function(c){return c.id===commodity;});

  function SignalBox(props){
    var s=props.signal;
    var color=s==="BUY"?T.green:s==="SELL"?T.red:T.accent;
    return(
      <span style={{color:color,fontWeight:900,fontFamily:"monospace",fontSize:13,border:"1px solid "+color,padding:"2px 10px",borderRadius:4}}>
        {s}
      </span>
    );
  }

  var navItems=[["overview","Overview"],["charts","Price Charts"],["analysis","AI Analysis"],["returns","Returns"],["table","Raw Data"]];

  return (
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>

      {/* Sidebar */}
      <div style={{position:"fixed",left:0,top:0,bottom:0,width:220,background:T.sidebar,borderRight:"1px solid "+T.cardBorder,display:"flex",flexDirection:"column",zIndex:100}}>

        <div style={{padding:"22px 18px 16px",borderBottom:"1px solid "+T.cardBorder}}>
          <div style={{fontSize:10,letterSpacing:"0.2em",color:T.accent,textTransform:"uppercase",fontWeight:700,marginBottom:2}}>AdmMedSofts</div>
          <div style={{fontSize:16,fontWeight:900,color:"#fff",letterSpacing:"-0.3px"}}>Commodity Hub</div>
          <div style={{fontSize:10,color:T.textMuted,marginTop:2,fontFamily:"monospace"}}>LIVE MARKET INTELLIGENCE</div>
        </div>

        <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.cardBorder,marginBottom:4}}>
          <button onClick={function(){setDark(!dark);}} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",borderRadius:8,border:"1px solid "+T.cardBorder,background:"transparent",cursor:"pointer",color:T.textSub,fontSize:10,fontFamily:"monospace",letterSpacing:"0.08em",fontWeight:700}}>
            <span>{dark?"DARK MODE":"LIGHT MODE"}</span>
            <div style={{width:36,height:18,borderRadius:9,background:dark?T.accent:"#cbd5e1",position:"relative",transition:"all 0.3s"}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:dark?20:2,transition:"left 0.3s",boxShadow:"0 1px 4px rgba(0,0,0,0.3)"}}/>
            </div>
          </button>
        </div>

        <div style={{padding:"12px 12px 4px"}}>
          <div style={{fontSize:9,color:T.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8,paddingLeft:6,fontWeight:700}}>Markets</div>
          {COMMODITIES.map(function(c){
            var active=commodity===c.id;
            return(
              <button key={c.id} onClick={function(){setCommodity(c.id);}}
                style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,border:"none",cursor:"pointer",marginBottom:2,background:active?dark?"rgba(56,189,248,0.1)":"rgba(14,165,233,0.1)":"transparent",color:active?T.accent:T.textSub,fontWeight:active?700:400,fontSize:13,transition:"all 0.15s",borderLeft:active?"2px solid "+T.accent:"2px solid transparent"}}>
                {c.label}
                {c.id!=="corn"&&<span style={{marginLeft:"auto",fontSize:9,color:T.textMuted,border:"1px solid "+T.cardBorder,padding:"1px 6px",borderRadius:4}}>Soon</span>}
              </button>
            );
          })}
        </div>

        <div style={{padding:"8px 12px 4px"}}>
          <div style={{fontSize:9,color:T.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8,paddingLeft:6,fontWeight:700}}>Views</div>
          {navItems.map(function(item){
            var id=item[0],label=item[1],active=activeTab===id;
            return(
              <button key={id} onClick={function(){setActiveTab(id);}}
                style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,border:"none",cursor:"pointer",marginBottom:2,background:active?dark?"rgba(56,189,248,0.08)":"rgba(14,165,233,0.08)":"transparent",color:active?T.accent:T.textSub,fontWeight:active?700:400,fontSize:13,borderLeft:active?"2px solid "+T.accent:"2px solid transparent"}}>
                {label}
              </button>
            );
          })}
        </div>

        <div style={{marginTop:"auto",padding:"14px"}}>
          <button onClick={function(){loadData(commodity);}} style={{width:"100%",padding:"8px",borderRadius:8,border:"1px solid "+T.cardBorder,background:"transparent",color:T.textSub,fontSize:11,cursor:"pointer",marginBottom:8,fontFamily:"monospace",letterSpacing:"0.05em"}}>REFRESH</button>
          <button onClick={runAIAnalysis} style={{width:"100%",padding:"9px",borderRadius:8,border:"1px solid "+T.accent,background:dark?"rgba(56,189,248,0.08)":"rgba(14,165,233,0.08)",color:T.accent,fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"monospace",letterSpacing:"0.05em"}}>RUN ANALYSIS</button>
          {lastUpdated&&<div style={{fontSize:9,color:T.textMuted,marginTop:6,textAlign:"center",fontFamily:"monospace"}}>UPDATED {lastUpdated.toLocaleTimeString()}</div>}
        </div>
      </div>

      {/* Main */}
      <div style={{marginLeft:220,padding:"24px 28px"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24,paddingBottom:16,borderBottom:"1px solid "+T.cardBorder}}>
          <div>
            <div style={{fontSize:11,color:T.textMuted,fontFamily:"monospace",letterSpacing:"0.1em",marginBottom:4}}>CBOT FUTURES · EGP LOCAL · {latest?latest.date:"—"}</div>
            <h1 style={{fontSize:22,fontWeight:900,margin:0,color:"#fff",letterSpacing:"-0.5px"}}>{cc?cc.label:""} Market</h1>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {alertActive&&<div style={{border:"1px solid "+T.red,background:"rgba(255,77,77,0.1)",borderRadius:8,padding:"6px 14px",fontSize:11,color:T.red,fontWeight:700,fontFamily:"monospace"}}>! {fmt(Math.abs(cbotPct))}% MOVE</div>}
            <div style={{border:"1px solid "+T.cardBorder,borderRadius:8,padding:"6px 14px",fontSize:11,color:T.textSub,fontFamily:"monospace"}}>{data.length} PTS</div>
            <div style={{border:"1px solid "+(trend==="bullish"?T.green:trend==="bearish"?T.red:T.accent),background:trend==="bullish"?"rgba(0,230,118,0.1)":trend==="bearish"?"rgba(255,77,77,0.1)":dark?"rgba(56,189,248,0.1)":"rgba(14,165,233,0.1)",borderRadius:8,padding:"6px 14px",fontSize:11,color:trend==="bullish"?T.green:trend==="bearish"?T.red:T.accent,fontWeight:700,fontFamily:"monospace"}}>
              {trend==="bullish"?"BULLISH +":trend==="bearish"?"BEARISH -":"NEUTRAL"}
            </div>
          </div>
        </div>

        {loading?(
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,color:T.textSub,fontFamily:"monospace"}}>
            <div style={{textAlign:"center"}}>LOADING MARKET DATA...</div>
          </div>
        ):!latest?(
          <div style={{textAlign:"center",padding:60,color:T.textSub}}><div>NO DATA AVAILABLE</div></div>
        ):(
          <div>
            {/* KPI Row */}
            {(activeTab==="overview"||activeTab==="charts"||activeTab==="analysis")&&(
              <div style={{marginBottom:20}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:12}}>
                  <KpiCard colors={T} label="CBOT Close" value={fmt(latest.closing_cbot)} unit="¢/bu" accentColor={T.accent} delta={cbotDelta} pct={cbotPct} />
                  <KpiCard colors={T} label="ARG Local Price" value={fmtK(latest.arg_price)} unit="EGP" accentColor={T.green} delta={argDelta} />
                  <KpiCard colors={T} label="Dollar Rate" value={fmt(latest.dollar_rate)} unit="EGP/USD" accentColor={T.blue} />
                  <KpiCard colors={T} label="RSI (14)" value={currentRSI?currentRSI.toFixed(1):"—"} unit={currentRSI?(currentRSI<30?"OVERSOLD":currentRSI>70?"OVERBOUGHT":"NEUTRAL"):""} accentColor={currentRSI?(currentRSI<30?T.green:currentRSI>70?T.red:T.accent):T.accent} />
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                  <KpiCard colors={T} label="CBOT Next-Day Forecast" value={latest.cbot_predicted?fmt(latest.cbot_predicted):"—"} unit="¢/bu predicted" accentColor={T.purple} mape={latest.mape_cbot} />
                  <KpiCard colors={T} label="ARG Forecast Accuracy" value={latest.arg_predicted?fmtK(latest.arg_predicted):"—"} unit="EGP predicted" accentColor={T.green} mape={latest.mape_arg} />
                  <KpiCard colors={T} label="BRZ Forecast Accuracy" value={latest.brz_predicted?fmtK(latest.brz_predicted):"—"} unit="EGP predicted" accentColor={T.cyan} mape={latest.mape_brz} />
                </div>
              </div>
            )}

            {/* Overview */}
            {activeTab==="overview"&&(
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
                <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"18px 18px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.textSub,fontFamily:"monospace",letterSpacing:"0.08em"}}>CBOT PRICE + MA7 + MA21</div>
                    <div style={{display:"flex",gap:12,fontSize:10,fontFamily:"monospace"}}>
                      <span style={{color:T.accent}}>● CLOSE</span>
                      <span style={{color:T.blue}}>● MA7</span>
                      <span style={{color:T.purple}}>● MA21</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={T.accent} stopOpacity={0.2}/>
                          <stop offset="95%" stopColor={T.accent} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid}/>
                      <XAxis dataKey="date" tick={{fill:T.textMuted,fontSize:9,fontFamily:"monospace"}}/>
                      <YAxis tick={{fill:T.textMuted,fontSize:9,fontFamily:"monospace"}} domain={["auto","auto"]}/>
                      <Tooltip content={<Tooltip2/>}/>
                      <Area type="monotone" dataKey="close" stroke={T.accent} strokeWidth={2} fill="url(#cg)" dot={false} name="Close"/>
                      <Line type="monotone" dataKey="ma7" stroke={T.blue} strokeWidth={1.5} dot={false} name="MA7" strokeDasharray="4 2"/>
                      <Line type="monotone" dataKey="ma21" stroke={T.purple} strokeWidth={1.5} dot={false} name="MA21" strokeDasharray="4 2"/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    {label:"Z-SCORE",value:zScore.toFixed(2),unit:Math.abs(zScore)>2?"EXTREME":"NORMAL",color:Math.abs(zScore)>2?T.red:T.cyan},
                    {label:"SUPPORT",value:fmt(srLevels.support),unit:"¢/bu FLOOR",color:T.green},
                    {label:"RESISTANCE",value:fmt(srLevels.resistance),unit:"¢/bu CEILING",color:T.red},
                    {label:"SIGNAL",value:overallSignal,unit:buyCount+"B / "+sellCount+"S",color:overallSignal==="BUY"?T.green:overallSignal==="SELL"?T.red:T.accent},
                    {label:"BRZ PRICE",value:fmtK(latest.brz_price),unit:"EGP equiv.",color:T.purple},
                  ].map(function(s,i){
                    return(
                      <div key={i} style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:10,padding:"10px 14px",flex:1}}>
                        <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.12em",fontWeight:700,fontFamily:"monospace"}}>{s.label}</div>
                        <div style={{fontSize:18,fontWeight:900,color:s.color,fontFamily:"monospace",marginTop:2}}>{s.value}</div>
                        <div style={{fontSize:10,color:T.textMuted,fontFamily:"monospace"}}>{s.unit}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Charts */}
            {activeTab==="charts"&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"18px 18px 12px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.textSub,fontFamily:"monospace",letterSpacing:"0.08em",marginBottom:14}}>PRICE + BOLLINGER BANDS</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid}/>
                      <XAxis dataKey="date" tick={{fill:T.textMuted,fontSize:9,fontFamily:"monospace"}}/>
                      <YAxis tick={{fill:T.textMuted,fontSize:9,fontFamily:"monospace"}} domain={["auto","auto"]}/>
                      <Tooltip content={<Tooltip2/>}/>
                      <Line type="monotone" dataKey="upper" stroke={T.cyan} strokeWidth={1} dot={false} name="BB Upper" strokeDasharray="3 3"/>
                      <Line type="monotone" dataKey="close" stroke={T.accent} strokeWidth={2.5} dot={false} name="Close"/>
                      <Line type="monotone" dataKey="lower" stroke={T.red} strokeWidth={1} dot={false} name="BB Lower" strokeDasharray="3 3"/>
                      <ReferenceLine y={srLevels.support} stroke={T.green} strokeDasharray="5 5" label={{value:"S",fill:T.green,fontSize:9,fontFamily:"monospace"}}/>
                      <ReferenceLine y={srLevels.resistance} stroke={T.red} strokeDasharray="5 5" label={{value:"R",fill:T.red,fontSize:9,fontFamily:"monospace"}}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                  <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"18px 18px 12px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.textSub,fontFamily:"monospace",letterSpacing:"0.08em",marginBottom:14}}>RSI (14)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={T.accent} stopOpacity={0.2}/>
                            <stop offset="95%" stopColor={T.accent} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid}/>
                        <XAxis dataKey="date" tick={{fill:T.textMuted,fontSize:8,fontFamily:"monospace"}}/>
                        <YAxis domain={[0,100]} tick={{fill:T.textMuted,fontSize:8,fontFamily:"monospace"}}/>
                        <Tooltip content={<Tooltip2/>}/>
                        <ReferenceLine y={70} stroke={T.red} strokeDasharray="4 4"/>
                        <ReferenceLine y={30} stroke={T.green} strokeDasharray="4 4"/>
                        <Area type="monotone" dataKey="rsi" stroke={T.accent} strokeWidth={2} fill="url(#rg)" dot={false} name="RSI"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"18px 18px 12px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.textSub,fontFamily:"monospace",letterSpacing:"0.08em",marginBottom:14}}>MACD HISTOGRAM</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid}/>
                        <XAxis dataKey="date" tick={{fill:T.textMuted,fontSize:8,fontFamily:"monospace"}}/>
                        <YAxis tick={{fill:T.textMuted,fontSize:8,fontFamily:"monospace"}}/>
                        <Tooltip content={<Tooltip2/>}/>
                        <ReferenceLine y={0} stroke={T.cardBorder} strokeWidth={2}/>
                        <Bar dataKey="histogram" name="MACD" fill={T.purple} radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Analysis */}
            {activeTab==="analysis"&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                  {[
                    {label:"OVERALL",value:overallSignal,sub:buyCount+"B / "+sellCount+"S"},
                    {label:"RSI SIGNAL",value:rsiSignal,sub:"RSI = "+(currentRSI?currentRSI.toFixed(1):"—")},
                    {label:"MACD SIGNAL",value:macdSignal,sub:currentMACD&&currentMACD.histogram?(currentMACD.histogram>0?"MOMENTUM +":"MOMENTUM -"):"—"},
                    {label:"TREND",value:trendSignal,sub:trend.toUpperCase()+" (5D)"},
                  ].map(function(card,i){
                    var color=card.value==="BUY"?T.green:card.value==="SELL"?T.red:T.accent;
                    return(
                      <div key={i} style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"16px 18px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.15em",fontWeight:700,fontFamily:"monospace",marginBottom:10}}>{card.label}</div>
                        <div style={{fontSize:16,fontWeight:900,color:color,fontFamily:"monospace",border:"1px solid "+color,display:"inline-block",padding:"3px 12px",borderRadius:4,marginBottom:8}}>{card.value}</div>
                        <div style={{fontSize:10,color:T.textMuted,fontFamily:"monospace"}}>{card.sub}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                  {[
                    {label:"Z-SCORE",value:zScore.toFixed(2),sub:Math.abs(zScore)>2?"EXTREME":"NORMAL",color:Math.abs(zScore)>2?T.red:T.cyan},
                    {label:"SUPPORT",value:fmt(srLevels.support),sub:"¢/bu FLOOR",color:T.green},
                    {label:"RESISTANCE",value:fmt(srLevels.resistance),sub:"¢/bu CEILING",color:T.red},
                    {label:"BOLLINGER",value:currentBoll&&currentBoll.upper?(latest.closing_cbot>currentBoll.upper?"ABOVE":latest.closing_cbot<currentBoll.lower?"BELOW":"INSIDE"):"—",sub:currentBoll&&currentBoll.upper?"UPPER: "+fmt(currentBoll.upper):"",color:T.purple},
                  ].map(function(card,i){
                    return(
                      <div key={i} style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"14px 18px"}}>
                        <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.15em",fontWeight:700,fontFamily:"monospace",marginBottom:6}}>{card.label}</div>
                        <div style={{fontSize:18,fontWeight:900,color:card.color,fontFamily:"monospace"}}>{card.value}</div>
                        <div style={{fontSize:10,color:T.textMuted,fontFamily:"monospace"}}>{card.sub}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"18px 22px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.accent,fontFamily:"monospace",letterSpacing:"0.08em"}}>AI MARKET ANALYSIS</div>
                    <button onClick={runAIAnalysis} style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+T.accent,background:dark?"rgba(56,189,248,0.08)":"rgba(14,165,233,0.08)",color:T.accent,fontSize:10,cursor:"pointer",fontWeight:700,fontFamily:"monospace",letterSpacing:"0.08em"}}>
                      {aiLoading?"ANALYZING...":"↻ REFRESH"}
                    </button>
                  </div>
                  {aiLoading?(
                    <div style={{color:T.textSub,fontSize:12,padding:"20px 0",textAlign:"center",fontFamily:"monospace"}}>
                      SCANNING MARKET DATA...
                    </div>
                  ):aiAnalysis?(
                    <div style={{color:T.text,fontSize:12,lineHeight:1.9,whiteSpace:"pre-wrap",fontFamily:"monospace"}}>{aiAnalysis}</div>
                  ):(
                    <div style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:"20px 0",fontFamily:"monospace"}}>
                      CLICK [RUN ANALYSIS] IN SIDEBAR TO START
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Returns */}
            {activeTab==="returns"&&(
              <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,padding:"18px 18px 12px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.textSub,fontFamily:"monospace",letterSpacing:"0.08em",marginBottom:14}}>DAILY FUTURES RETURNS (%)</div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid}/>
                    <XAxis dataKey="date" tick={{fill:T.textMuted,fontSize:9,fontFamily:"monospace"}}/>
                    <YAxis tick={{fill:T.textMuted,fontSize:9,fontFamily:"monospace"}} tickFormatter={function(v){return v+"%";}}/>
                    <Tooltip content={<Tooltip2/>}/>
                    <ReferenceLine y={0} stroke={T.cardBorder} strokeWidth={2}/>
                    <Bar dataKey="ret" name="Return (%)" fill={T.accent} radius={[3,3,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            {activeTab==="table"&&(
              <div style={{background:T.card,border:"1px solid "+T.cardBorder,borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"14px 18px",borderBottom:"1px solid "+T.cardBorder,fontSize:11,fontWeight:700,color:T.textSub,fontFamily:"monospace",letterSpacing:"0.1em"}}>
                  RAW DATA — {data.length} RECORDS
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                    <thead>
                      <tr style={{background:dark?"#070710":T.bg}}>
                        {["DATE","CLOSE","LOW","HIGH","USD RATE","ARG","BRZ","RETURN"].map(function(h){
                          return <th key={h} style={{padding:"10px 14px",textAlign:"left",color:T.textMuted,fontWeight:700,fontSize:9,letterSpacing:"0.12em",whiteSpace:"nowrap"}}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(function(row,i){
                        var rc=row.fut_ret>0?T.green:row.fut_ret<0?T.red:T.textSub;
                        return(
                          <tr key={i} style={{borderTop:"1px solid "+T.cardBorder,background:i===0?dark?"rgba(56,189,248,0.04)":"rgba(14,165,233,0.04)":"transparent"}}>
                            <td style={{padding:"8px 14px",color:i===0?T.accent:T.textSub,fontWeight:i===0?700:400}}>{row.date}</td>
                            <td style={{padding:"8px 14px",color:"#fff",fontWeight:700}}>{fmt(row.closing_cbot)}</td>
                            <td style={{padding:"8px 14px",color:T.textSub}}>{fmt(row.cbot_low)}</td>
                            <td style={{padding:"8px 14px",color:T.textSub}}>{fmt(row.cbot_high)}</td>
                            <td style={{padding:"8px 14px",color:T.textSub}}>{fmt(row.dollar_rate)}</td>
                            <td style={{padding:"8px 14px",color:T.green,fontWeight:600}}>{Math.round(row.arg_price).toLocaleString()}</td>
                            <td style={{padding:"8px 14px",color:T.accent,fontWeight:600}}>{Math.round(row.brz_price).toLocaleString()}</td>
                            <td style={{padding:"8px 14px",color:rc,fontWeight:600}}>{fmt(row.fut_ret*100,2)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
