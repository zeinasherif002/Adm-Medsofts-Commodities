import { useState, useEffect } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E";
const HEADERS = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
const COMMODITIES = [
  { id: "corn", label: "Corn" },
  { id: "wheat", label: "Wheat" },
  { id: "soybeans", label: "Soybeans" },
];

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

function ChartTooltip(props) {
  var active=props.active, payload=props.payload, label=props.label;
  if(!active||!payload||!payload.length)return null;
  return (
    <div style={{background:"#151c2c",border:"1px solid #1e2d45",borderRadius:8,padding:"8px 12px",fontSize:11}}>
      <p style={{color:"#8b9ab5",marginBottom:4,fontWeight:600}}>{label}</p>
      {payload.map(function(p,i){
        if(p.value===null||p.value===undefined)return null;
        return <p key={i} style={{color:p.color,margin:"1px 0"}}>{p.name}: <strong>{typeof p.value==="number"?p.value.toFixed(2):p.value}</strong></p>;
      })}
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
  var [weeklyData,setWeeklyData]=useState([]);

  function loadData(c) {
    setLoading(true);
    fetch(SUPABASE_URL+"/rest/v1/commodity_prices?commodity=eq."+c+"&order=date.desc&limit=60",{headers:HEADERS})
      .then(function(r){return r.json();})
      .then(function(rows){setData(rows);setLastUpdated(new Date());setLoading(false);})
      .catch(function(e){console.error(e);setLoading(false);});
  }

  function loadWeekly(c) {
    fetch(SUPABASE_URL+"/rest/v1/weekly_forecast?commodity=eq."+c+"&order=forecast_date.asc&limit=10",{headers:HEADERS})
      .then(function(r){return r.json();})
      .then(function(rows){setWeeklyData(rows);})
      .catch(function(e){console.error(e);});
  }

  useEffect(function(){
    loadData(commodity);
    loadWeekly(commodity);
    var iv=setInterval(function(){loadData(commodity);},5*60*1000);
    return function(){clearInterval(iv);};
  },[commodity]);

  var latest=data[0],prev=data[1];
  var cbotDelta=latest&&prev?latest.closing_cbot-prev.closing_cbot:0;
  var cbotPct=prev&&prev.closing_cbot?(cbotDelta/prev.closing_cbot)*100:0;
  var argDelta=latest&&prev?latest.arg_price-prev.arg_price:0;

  var prices=data.slice().reverse().map(function(d){return d.closing_cbot;});
  var dates=data.slice().reverse().map(function(d){return d.date?d.date.slice(5):"";});

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
    lines.push("PRICE SUMMARY — "+latest.date);
    lines.push("─────────────────────────────────────────");
    if(cbotDelta>0)lines.push("UP "+Math.abs(cbotDelta).toFixed(2)+" ("+Math.abs(cbotPct).toFixed(2)+"%) — closed at "+cbot.toFixed(2)+" cents/bu.");
    else if(cbotDelta<0)lines.push("DOWN "+Math.abs(cbotDelta).toFixed(2)+" ("+Math.abs(cbotPct).toFixed(2)+"%) — closed at "+cbot.toFixed(2)+" cents/bu.");
    else lines.push("FLAT — closed at "+cbot.toFixed(2)+" cents/bu.");
    lines.push("5-session: "+(pct5>=0?"+":"")+pct5.toFixed(2)+"% — "+(pct5>2?"sustained uptrend.":pct5<-2?"sustained selling.":"consolidating."));
    lines.push(""); lines.push("TECHNICAL INDICATORS");
    lines.push("─────────────────────────────────────────");
    if(currentRSI!==null){
      var r="RSI(14) = "+currentRSI.toFixed(1)+" — ";
      if(currentRSI<30)r+="OVERSOLD, bounce potential.";
      else if(currentRSI<45)r+="Bearish zone.";
      else if(currentRSI<55)r+="Neutral.";
      else if(currentRSI<70)r+="Bullish zone.";
      else r+="OVERBOUGHT, pullback risk.";
      lines.push(r);
    }
    if(currentMACD&&currentMACD.histogram!==null) lines.push("MACD = "+currentMACD.histogram.toFixed(4)+" — "+(currentMACD.histogram>0?"Bullish momentum.":"Bearish momentum."));
    if(currentBoll&&currentBoll.upper!==null) lines.push("Bollinger — "+(cbot>currentBoll.upper?"Above upper band, overbought.":cbot<currentBoll.lower?"Below lower band, oversold.":"Inside band, normal volatility."));
    lines.push("Z-Score = "+zScore.toFixed(2)+(Math.abs(zScore)>2?" — EXTREME move!":" — Normal range."));
    var ma7v=ma7[ma7.length-1],ma21v=ma21[ma21.length-1];
    if(ma7v&&ma21v)lines.push("MA7="+ma7v.toFixed(2)+" | MA21="+ma21v.toFixed(2)+" — "+(ma7v>ma21v?"Bullish alignment.":"Bearish alignment."));
    lines.push(""); lines.push("KEY LEVELS");
    lines.push("─────────────────────────────────────────");
    lines.push("Support:    "+srLevels.support.toFixed(2)+" cents/bu");
    lines.push("Resistance: "+srLevels.resistance.toFixed(2)+" cents/bu");
    lines.push(""); lines.push("LOCAL MARKET (EGP)");
    lines.push("─────────────────────────────────────────");
    lines.push("Dollar Rate: "+latest.dollar_rate.toFixed(2)+" EGP/USD");
    lines.push("ARG Price:   "+Math.round(latest.arg_price).toLocaleString()+" EGP");
    lines.push("BRZ Price:   "+Math.round(latest.brz_price).toLocaleString()+" EGP");
    lines.push(""); lines.push("SIGNAL: "+overallSignal+" ("+buyCount+" buy / "+sellCount+" sell)");
    lines.push("─────────────────────────────────────────");
    if(overallSignal==="BUY")lines.push("Bullish bias. Watch resistance: "+srLevels.resistance.toFixed(2)+".");
    else if(overallSignal==="SELL")lines.push("Bearish bias. Watch support: "+srLevels.support.toFixed(2)+".");
    else lines.push("Mixed signals. Wait for breakout.");
    lines.push("\nAdmMedSofts Commodity Intelligence");
    return lines.join("\n");
  }

  var cc=COMMODITIES.find(function(c){return c.id===commodity;});

  var signalColor=overallSignal==="BUY"?"#22c55e":overallSignal==="SELL"?"#ef4444":"#f59e0b";
  var trendColor=trend==="bullish"?"#22c55e":trend==="bearish"?"#ef4444":"#f59e0b";

  var navItems=[
    ["overview","Overview"],
    ["charts","Charts"],
    ["analysis","AI Analysis"],
    ["returns","Returns"],
    ["table","Raw Data"],
    ["weekly","Weekly Forecast"],
  ];

  var s={
    bg:"#0c1220",
    sidebar:"#0f1729",
    card:"#131e30",
    cardHover:"#162236",
    border:"#1e2d45",
    text:"#e2e8f0",
    textSub:"#64748b",
    textMuted:"#374151",
    blue:"#3b82f6",
    purple:"#8b5cf6",
    green:"#22c55e",
    red:"#ef4444",
    amber:"#f59e0b",
    cyan:"#06b6d4",
  };

  function Card(props) {
    var label=props.label,value=props.value,unit=props.unit,color=props.color,delta=props.delta,pct=props.pct,mape=props.mape,small=props.small;
    var dc=delta===undefined?s.textSub:delta>0?s.green:delta<0?s.red:s.textSub;
    return (
      <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:small?"14px 16px":"18px 20px",position:"relative",overflow:"hidden",transition:"background 0.2s"}}>
        <div style={{position:"absolute",top:-1,left:0,right:0,height:2,background:color,borderRadius:"14px 14px 0 0",opacity:0.8}}/>
        <div style={{fontSize:10,fontWeight:700,color:s.textSub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>{label}</div>
        <div style={{fontSize:small?20:24,fontWeight:800,color:s.text,lineHeight:1,marginBottom:4,fontVariantNumeric:"tabular-nums"}}>{value}</div>
        <div style={{fontSize:11,color:s.textMuted}}>{unit}</div>
        {delta!==undefined&&(
          <div style={{marginTop:6,fontSize:11,fontWeight:700,color:dc}}>
            {delta>0?"+":delta<0?"-":""}{fmt(Math.abs(delta))}{pct!==undefined?" ("+fmt(Math.abs(pct))+"%)":""}
          </div>
        )}
        {mape!==undefined&&(
          <div style={{marginTop:6,fontSize:10,color:mape!==null?(mape<2?s.green:mape<5?s.amber:s.red):s.textMuted}}>
            MAPE: {mape!==null?mape.toFixed(2)+"%":"accumulating..."}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:s.bg,color:s.text,fontFamily:"'Inter','DM Sans','Segoe UI',sans-serif",display:"flex"}}>

      {/* Sidebar */}
      <div style={{width:220,minHeight:"100vh",background:s.sidebar,borderRight:"1px solid "+s.border,display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,bottom:0,overflowY:"auto"}}>

        {/* Logo */}
        <div style={{padding:"20px 20px 16px",borderBottom:"1px solid "+s.border}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,"+s.blue+","+s.purple+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#fff"}}>AM</div>
            <div>
              <div style={{fontSize:13,fontWeight:800,color:s.text,lineHeight:1.1}}>AdmMedSofts</div>
              <div style={{fontSize:10,color:s.textSub,marginTop:1}}>Commodity Hub</div>
            </div>
          </div>
        </div>

        {/* Markets */}
        <div style={{padding:"16px 12px 8px"}}>
          <div style={{fontSize:10,fontWeight:700,color:s.textMuted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,paddingLeft:8}}>Markets</div>
          {COMMODITIES.map(function(c){
            var active=commodity===c.id;
            return(
              <button key={c.id} onClick={function(){setCommodity(c.id);}}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",marginBottom:2,background:active?"rgba(59,130,246,0.12)":"transparent",color:active?s.blue:s.textSub,fontWeight:active?600:400,fontSize:13,transition:"all 0.15s",textAlign:"left"}}>
                <span>{c.label}</span>
                {c.id!=="corn"&&<span style={{fontSize:9,color:s.textMuted,border:"1px solid "+s.border,padding:"1px 6px",borderRadius:4}}>Soon</span>}
                {active&&<div style={{width:4,height:4,borderRadius:"50%",background:s.blue}}/>}
              </button>
            );
          })}
        </div>

        {/* Views */}
        <div style={{padding:"8px 12px"}}>
          <div style={{fontSize:10,fontWeight:700,color:s.textMuted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8,paddingLeft:8}}>Views</div>
          {navItems.map(function(item){
            var id=item[0],label=item[1],active=activeTab===id;
            return(
              <button key={id} onClick={function(){setActiveTab(id);}}
                style={{width:"100%",display:"flex",alignItems:"center",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",marginBottom:2,background:active?"rgba(59,130,246,0.12)":"transparent",color:active?s.blue:s.textSub,fontWeight:active?600:400,fontSize:13,transition:"all 0.15s",textAlign:"left",borderLeft:active?"2px solid "+s.blue:"2px solid transparent"}}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Bottom */}
        <div style={{marginTop:"auto",padding:"12px 12px 16px",borderTop:"1px solid "+s.border}}>
          <button onClick={function(){loadData(commodity);loadWeekly(commodity);}} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid "+s.border,background:"transparent",color:s.textSub,fontSize:11,cursor:"pointer",marginBottom:8,textAlign:"left",fontWeight:500}}>
            Refresh Data
          </button>
          <button onClick={runAIAnalysis} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"none",background:"linear-gradient(135deg,"+s.blue+","+s.purple+")",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:700}}>
            Run AI Analysis
          </button>
          {lastUpdated&&<div style={{fontSize:9,color:s.textMuted,marginTop:8,textAlign:"center"}}>Updated {lastUpdated.toLocaleTimeString()}</div>}
        </div>
      </div>

      {/* Main */}
      <div style={{marginLeft:220,flex:1,padding:"24px 28px",minWidth:0}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:800,margin:0,color:s.text,letterSpacing:"-0.3px"}}>{cc?cc.label:""} Market</h1>
            <div style={{fontSize:12,color:s.textSub,marginTop:3}}>CBOT Futures · EGP Local Prices · {latest?latest.date:"—"}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {Math.abs(cbotPct)>=2&&(
              <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"6px 12px",fontSize:11,color:s.red,fontWeight:600}}>
                {fmt(Math.abs(cbotPct))}% move
              </div>
            )}
            <div style={{background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.2)",borderRadius:8,padding:"6px 12px",fontSize:11,color:s.blue,fontWeight:500}}>
              {data.length} pts
            </div>
            <div style={{background:trend==="bullish"?"rgba(34,197,94,0.1)":trend==="bearish"?"rgba(239,68,68,0.1)":"rgba(245,158,11,0.1)",border:"1px solid "+(trend==="bullish"?"rgba(34,197,94,0.3)":trend==="bearish"?"rgba(239,68,68,0.3)":"rgba(245,158,11,0.3)"),borderRadius:8,padding:"6px 12px",fontSize:11,color:trendColor,fontWeight:700}}>
              {trend==="bullish"?"Bullish":trend==="bearish"?"Bearish":"Neutral"}
            </div>
          </div>
        </div>

        {loading?(
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,color:s.textSub,fontSize:13}}>Loading market data...</div>
        ):!latest?(
          <div style={{textAlign:"center",padding:60,color:s.textSub}}>No data available</div>
        ):(
          <div>
            {/* KPI Row 1 */}
            {(activeTab==="overview"||activeTab==="charts"||activeTab==="analysis")&&(
              <div style={{marginBottom:16}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:12}}>
                  <Card label="CBOT Close" value={fmt(latest.closing_cbot)} unit="cents/bu" color={s.blue} delta={cbotDelta} pct={cbotPct}/>
                  <Card label="Day Range" value={fmt(latest.cbot_low)+" – "+fmt(latest.cbot_high)} unit="cents/bu" color={s.cyan}/>
                  <Card label="ARG Price" value={fmtK(latest.arg_price)} unit="EGP" color={s.green} delta={argDelta}/>
                  <Card label="BRZ Price" value={fmtK(latest.brz_price)} unit="EGP" color={s.amber}/>
                  <Card label="Dollar Rate" value={fmt(latest.dollar_rate)} unit="EGP/USD" color={s.purple}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                  <Card label="CBOT Next-Day Forecast" value={latest.cbot_predicted?fmt(latest.cbot_predicted):"—"} unit="cents/bu predicted" color={s.blue} mape={latest.mape_cbot} small={true}/>
                  <Card label="ARG Forecast Accuracy" value={latest.arg_predicted?fmtK(latest.arg_predicted):"—"} unit="EGP predicted" color={s.green} mape={latest.mape_arg} small={true}/>
                  <Card label="BRZ Forecast Accuracy" value={latest.brz_predicted?fmtK(latest.brz_predicted):"—"} unit="EGP predicted" color={s.amber} mape={latest.mape_brz} small={true}/>
                </div>
              </div>
            )}

            {/* Overview */}
            {activeTab==="overview"&&(
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
                <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:"18px 20px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:700,color:s.text}}>CBOT Price Trend</div>
                    <div style={{display:"flex",gap:14,fontSize:10,color:s.textSub}}>
                      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:2,background:s.blue,display:"inline-block",borderRadius:2}}></span>Close</span>
                      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:2,background:s.amber,display:"inline-block",borderRadius:2}}></span>MA7</span>
                      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:2,background:s.purple,display:"inline-block",borderRadius:2}}></span>MA21</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={s.blue} stopOpacity={0.15}/>
                          <stop offset="95%" stopColor={s.blue} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={s.border}/>
                      <XAxis dataKey="date" tick={{fill:s.textSub,fontSize:10}}/>
                      <YAxis tick={{fill:s.textSub,fontSize:10}} domain={["auto","auto"]}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Area type="monotone" dataKey="close" stroke={s.blue} strokeWidth={2} fill="url(#cg)" dot={false} name="Close"/>
                      <Line type="monotone" dataKey="ma7" stroke={s.amber} strokeWidth={1.5} dot={false} name="MA7" strokeDasharray="4 2"/>
                      <Line type="monotone" dataKey="ma21" stroke={s.purple} strokeWidth={1.5} dot={false} name="MA21" strokeDasharray="4 2"/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    {label:"Overall Signal",value:overallSignal,color:signalColor,sub:buyCount+" buy / "+sellCount+" sell"},
                    {label:"RSI (14)",value:currentRSI?currentRSI.toFixed(1):"—",color:currentRSI?(currentRSI<30?s.green:currentRSI>70?s.red:s.amber):s.amber,sub:currentRSI?(currentRSI<30?"Oversold":currentRSI>70?"Overbought":"Neutral"):""},
                    {label:"Z-Score",value:zScore.toFixed(2),color:Math.abs(zScore)>2?s.red:s.cyan,sub:Math.abs(zScore)>2?"Extreme move":"Normal range"},
                    {label:"Support",value:fmt(srLevels.support),color:s.green,sub:"cents/bu floor"},
                    {label:"Resistance",value:fmt(srLevels.resistance),color:s.red,sub:"cents/bu ceiling"},
                  ].map(function(item,i){
                    return(
                      <div key={i} style={{background:s.card,border:"1px solid "+s.border,borderRadius:12,padding:"12px 14px",flex:1}}>
                        <div style={{fontSize:10,fontWeight:700,color:s.textMuted,textTransform:"uppercase",letterSpacing:"0.1em"}}>{item.label}</div>
                        <div style={{fontSize:18,fontWeight:800,color:item.color,marginTop:2,fontVariantNumeric:"tabular-nums"}}>{item.value}</div>
                        <div style={{fontSize:10,color:s.textSub}}>{item.sub}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Charts */}
            {activeTab==="charts"&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:"18px 20px 12px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:s.text,marginBottom:14}}>Price + Bollinger Bands</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={s.border}/>
                      <XAxis dataKey="date" tick={{fill:s.textSub,fontSize:10}}/>
                      <YAxis tick={{fill:s.textSub,fontSize:10}} domain={["auto","auto"]}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Line type="monotone" dataKey="upper" stroke={s.cyan} strokeWidth={1} dot={false} name="BB Upper" strokeDasharray="3 3"/>
                      <Line type="monotone" dataKey="close" stroke={s.blue} strokeWidth={2.5} dot={false} name="Close"/>
                      <Line type="monotone" dataKey="lower" stroke={s.red} strokeWidth={1} dot={false} name="BB Lower" strokeDasharray="3 3"/>
                      <ReferenceLine y={srLevels.support} stroke={s.green} strokeDasharray="4 4" label={{value:"S",fill:s.green,fontSize:9}}/>
                      <ReferenceLine y={srLevels.resistance} stroke={s.red} strokeDasharray="4 4" label={{value:"R",fill:s.red,fontSize:9}}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                  <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:"18px 20px 12px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:s.text,marginBottom:14}}>RSI (14)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={s.amber} stopOpacity={0.15}/>
                            <stop offset="95%" stopColor={s.amber} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={s.border}/>
                        <XAxis dataKey="date" tick={{fill:s.textSub,fontSize:9}}/>
                        <YAxis domain={[0,100]} tick={{fill:s.textSub,fontSize:9}}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <ReferenceLine y={70} stroke={s.red} strokeDasharray="4 4"/>
                        <ReferenceLine y={30} stroke={s.green} strokeDasharray="4 4"/>
                        <Area type="monotone" dataKey="rsi" stroke={s.amber} strokeWidth={2} fill="url(#rg)" dot={false} name="RSI"/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:"18px 20px 12px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:s.text,marginBottom:14}}>MACD Histogram</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={s.border}/>
                        <XAxis dataKey="date" tick={{fill:s.textSub,fontSize:9}}/>
                        <YAxis tick={{fill:s.textSub,fontSize:9}}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <ReferenceLine y={0} stroke={s.border} strokeWidth={2}/>
                        <Bar dataKey="histogram" name="MACD" fill={s.purple} radius={[2,2,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Analysis */}
            {activeTab==="analysis"&&(
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                  {[
                    {label:"Overall Signal",value:overallSignal,color:signalColor,sub:buyCount+"B / "+sellCount+"S"},
                    {label:"RSI Signal",value:rsiSignal,color:rsiSignal==="BUY"?s.green:rsiSignal==="SELL"?s.red:s.amber,sub:"RSI = "+(currentRSI?currentRSI.toFixed(1):"—")},
                    {label:"MACD Signal",value:macdSignal,color:macdSignal==="BUY"?s.green:macdSignal==="SELL"?s.red:s.amber,sub:currentMACD&&currentMACD.histogram?(currentMACD.histogram>0?"Momentum +":"Momentum -"):"—"},
                    {label:"Trend",value:trendSignal,color:trendSignal==="BUY"?s.green:trendSignal==="SELL"?s.red:s.amber,sub:trend+" (5-day)"},
                  ].map(function(c,i){
                    return(
                      <div key={i} style={{background:s.card,border:"1px solid "+s.border,borderRadius:12,padding:"16px 18px",textAlign:"center"}}>
                        <div style={{fontSize:10,fontWeight:700,color:s.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>{c.label}</div>
                        <div style={{fontSize:16,fontWeight:800,color:c.color,border:"1px solid "+c.color+"40",display:"inline-block",padding:"3px 14px",borderRadius:6,marginBottom:6}}>{c.value}</div>
                        <div style={{fontSize:10,color:s.textSub}}>{c.sub}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                  {[
                    {label:"Z-Score",value:zScore.toFixed(2),color:Math.abs(zScore)>2?s.red:s.cyan,sub:Math.abs(zScore)>2?"Extreme":"Normal"},
                    {label:"Support",value:fmt(srLevels.support),color:s.green,sub:"cents/bu floor"},
                    {label:"Resistance",value:fmt(srLevels.resistance),color:s.red,sub:"cents/bu ceiling"},
                    {label:"Bollinger",value:currentBoll&&currentBoll.upper?(latest.closing_cbot>currentBoll.upper?"Above":latest.closing_cbot<currentBoll.lower?"Below":"Inside"):"—",color:s.purple,sub:currentBoll&&currentBoll.upper?"Upper: "+fmt(currentBoll.upper):""},
                  ].map(function(c,i){
                    return(
                      <div key={i} style={{background:s.card,border:"1px solid "+s.border,borderRadius:12,padding:"14px 16px"}}>
                        <div style={{fontSize:10,fontWeight:700,color:s.textMuted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{c.label}</div>
                        <div style={{fontSize:18,fontWeight:800,color:c.color,fontVariantNumeric:"tabular-nums"}}>{c.value}</div>
                        <div style={{fontSize:10,color:s.textSub}}>{c.sub}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:"18px 22px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:700,color:s.text}}>AI Market Analysis</div>
                    <button onClick={runAIAnalysis} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+s.border,background:"transparent",color:s.textSub,fontSize:11,cursor:"pointer",fontWeight:600}}>
                      {aiLoading?"Analyzing...":"Refresh"}
                    </button>
                  </div>
                  {aiLoading?(
                    <div style={{color:s.textSub,fontSize:12,padding:"16px 0",textAlign:"center"}}>Scanning market data...</div>
                  ):aiAnalysis?(
                    <div style={{color:s.text,fontSize:12,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>{aiAnalysis}</div>
                  ):(
                    <div style={{color:s.textSub,fontSize:12,textAlign:"center",padding:"16px 0"}}>Click "Run AI Analysis" in the sidebar to start.</div>
                  )}
                </div>
              </div>
            )}

            {/* Returns */}
            {activeTab==="returns"&&(
              <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,padding:"18px 20px 12px"}}>
                <div style={{fontSize:12,fontWeight:700,color:s.text,marginBottom:14}}>Daily Futures Returns (%)</div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={s.border}/>
                    <XAxis dataKey="date" tick={{fill:s.textSub,fontSize:10}}/>
                    <YAxis tick={{fill:s.textSub,fontSize:10}} tickFormatter={function(v){return v+"%";}}/>
                    <Tooltip content={<ChartTooltip/>}/>
                    <ReferenceLine y={0} stroke={s.border} strokeWidth={2}/>
                    <Bar dataKey="ret" name="Return (%)" fill={s.blue} radius={[3,3,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Weekly Forecast */}
            {activeTab==="weekly"&&(
              <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,overflow:"hidden"}}>
                <div style={{padding:"16px 20px",borderBottom:"1px solid "+s.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:s.text}}>Weekly Price Forecast — Next 5 Trading Days</div>
                  <div style={{fontSize:11,color:s.textSub}}>Generated by XGBoost + Ridge models</div>
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:s.bg}}>
                      {["Date","CBOT Forecast (¢/bu)","ARG Forecast (EGP)","BRZ Forecast (EGP)"].map(function(h){
                        return <th key={h} style={{padding:"10px 20px",textAlign:"left",color:s.textSub,fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em"}}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyData.length===0?(
                      <tr><td colSpan="4" style={{padding:"24px",textAlign:"center",color:s.textSub}}>No forecast data available</td></tr>
                    ):weeklyData.map(function(row,i){
                      return(
                        <tr key={i} style={{borderTop:"1px solid "+s.border,background:i%2===0?"transparent":s.bg+"80"}}>
                          <td style={{padding:"12px 20px",color:i===0?s.blue:s.text,fontWeight:i===0?700:500}}>{row.forecast_date}</td>
                          <td style={{padding:"12px 20px",color:s.blue,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{row.cbot_forecast?Number(row.cbot_forecast).toFixed(2):"—"}</td>
                          <td style={{padding:"12px 20px",color:s.green,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{row.arg_forecast?Math.round(row.arg_forecast).toLocaleString():"—"}</td>
                          <td style={{padding:"12px 20px",color:s.amber,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{row.brz_forecast?Math.round(row.brz_forecast).toLocaleString():"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Raw Data */}
            {activeTab==="table"&&(
              <div style={{background:s.card,border:"1px solid "+s.border,borderRadius:14,overflow:"hidden"}}>
                <div style={{padding:"16px 20px",borderBottom:"1px solid "+s.border,fontSize:13,fontWeight:700,color:s.text}}>
                  Raw Data — {data.length} records
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:s.bg}}>
                        {["Date","Close ¢/bu","Low","High","USD Rate","ARG Price","BRZ Price","Return"].map(function(h){
                          return <th key={h} style={{padding:"10px 16px",textAlign:"left",color:s.textSub,fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(function(row,i){
                        var rc=row.fut_ret>0?s.green:row.fut_ret<0?s.red:s.textSub;
                        return(
                          <tr key={i} style={{borderTop:"1px solid "+s.border,background:i%2===0?"transparent":s.bg+"80"}}>
                            <td style={{padding:"9px 16px",color:i===0?s.blue:s.textSub,fontWeight:i===0?700:400}}>{row.date}</td>
                            <td style={{padding:"9px 16px",color:s.text,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(row.closing_cbot)}</td>
                            <td style={{padding:"9px 16px",color:s.textSub,fontVariantNumeric:"tabular-nums"}}>{fmt(row.cbot_low)}</td>
                            <td style={{padding:"9px 16px",color:s.textSub,fontVariantNumeric:"tabular-nums"}}>{fmt(row.cbot_high)}</td>
                            <td style={{padding:"9px 16px",color:s.textSub,fontVariantNumeric:"tabular-nums"}}>{fmt(row.dollar_rate)}</td>
                            <td style={{padding:"9px 16px",color:s.green,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{Math.round(row.arg_price).toLocaleString()}</td>
                            <td style={{padding:"9px 16px",color:s.amber,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{Math.round(row.brz_price).toLocaleString()}</td>
                            <td style={{padding:"9px 16px",color:rc,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{fmt(row.fut_ret*100,2)}%</td>
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