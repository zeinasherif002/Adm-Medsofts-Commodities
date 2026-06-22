import { useState, useEffect } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E";
const HEADERS = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
const COMMODITIES = [{ id: "corn", label: "Corn" }, { id: "wheat", label: "Wheat" }, { id: "soybeans", label: "Soybeans" }];

function fmt(n, d) { if (d === undefined) d = 2; return Number(n).toFixed(d); }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : fmt(n); }
function calcMA(prices, period) { return prices.map(function(_, i) { if (i < period - 1) return null; var s = prices.slice(i - period + 1, i + 1); return s.reduce(function(a, b) { return a + b; }, 0) / period; }); }
function calcRSI(prices, period) { if (!period) period = 14; var rsi = new Array(prices.length).fill(null); for (var i = period; i < prices.length; i++) { var g = 0, l = 0; for (var j = i - period + 1; j <= i; j++) { var d = prices[j] - prices[j-1]; if (d > 0) g += d; else l -= d; } var ag = g/period, al = l/period; rsi[i] = al === 0 ? 100 : 100 - (100 / (1 + ag/al)); } return rsi; }
function calcBollinger(prices, period, mult) { if (!period) period = 20; if (!mult) mult = 2; return prices.map(function(_, i) { if (i < period - 1) return { upper: null, lower: null }; var s = prices.slice(i - period + 1, i + 1); var mean = s.reduce(function(a,b){return a+b;},0)/period; var std = Math.sqrt(s.reduce(function(a,b){return a+Math.pow(b-mean,2);},0)/period); return { upper: mean + mult*std, lower: mean - mult*std }; }); }
function calcEMA(prices, period) { var k = 2/(period+1), ema = new Array(prices.length).fill(null), fv = -1; for (var i = 0; i < prices.length; i++) { if (prices[i] !== null) { fv = i; break; } } if (fv === -1) return ema; ema[fv] = prices[fv]; for (var i = fv+1; i < prices.length; i++) ema[i] = prices[i] === null ? ema[i-1] : prices[i]*k + ema[i-1]*(1-k); return ema; }
function calcMACD(prices) { var e12=calcEMA(prices,12), e26=calcEMA(prices,26); var ml=prices.map(function(_,i){return (e12[i]===null||e26[i]===null)?null:e12[i]-e26[i];}); var sl=calcEMA(ml.filter(function(v){return v!==null;}),9); var res=new Array(prices.length).fill(null), ni=0; ml.forEach(function(v,i){ if(v!==null){res[i]={macd:v,signal:sl[ni]||null,histogram:sl[ni]!==null?v-sl[ni]:null};ni++;} else res[i]={macd:null,signal:null,histogram:null}; }); return res; }
function calcSR(prices) { var s=prices.slice().sort(function(a,b){return a-b;}); return {support:s[Math.floor(s.length*0.1)],resistance:s[Math.floor(s.length*0.9)]}; }
function calcZScore(prices) { var mean=prices.reduce(function(a,b){return a+b;},0)/prices.length; var std=Math.sqrt(prices.reduce(function(a,b){return a+Math.pow(b-mean,2);},0)/prices.length); return std===0?0:(prices[prices.length-1]-mean)/std; }
function getTrend(prices) { if(prices.length<5)return "neutral"; var r=prices.slice(-5), pct=(r[r.length-1]-r[0])/r[0]*100; return pct>1?"bullish":pct<-1?"bearish":"neutral"; }
function TT(props) { var active=props.active, payload=props.payload, label=props.label; if(!active||!payload||!payload.length)return null; return (<div style={{background:"#1a2035",border:"1px solid #2a3550",borderRadius:10,padding:"10px 14px",fontSize:11,boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}><p style={{color:"#7b8db0",marginBottom:5,fontWeight:600}}>{label}</p>{payload.map(function(p,i){if(p.value===null||p.value===undefined)return null;return <p key={i} style={{color:p.color,margin:"2px 0"}}>{p.name}: <strong>{typeof p.value==="number"?p.value.toFixed(2):p.value}</strong></p>;})}</div>); }

export default function App() {
  var [commodity,setCommodity]=useState("corn");
  var [data,setData]=useState([]);
  var [loading,setLoading]=useState(true);
  var [tab,setTab]=useState("overview");
  var [updated,setUpdated]=useState(null);
  var [ai,setAi]=useState("");
  var [aiLoad,setAiLoad]=useState(false);
  var [weekly,setWeekly]=useState([]);
  var [showAlerts,setShowAlerts]=useState(false);
  var [news,setNews]=useState([]);
  var [newsLoad,setNewsLoad]=useState(false);
  var [cropCondition,setCropCondition]=useState(null);
  var [wasde,setWasde]=useState(null);
  var [wasdeWheat,setWasdeWheat]=useState(null);

  function loadWasde(){
    fetch(SUPABASE_URL+"/rest/v1/wasde_analysis?commodity=eq.corn&order=created_at.desc&limit=1",{headers:HEADERS})
      .then(function(r){return r.json();})
      .then(function(data){if(data&&data.length>0) setWasde(data[0]);})
      .catch(function(e){console.error("WASDE error:",e);});
    fetch(SUPABASE_URL+"/rest/v1/wasde_analysis?commodity=eq.wheat&order=created_at.desc&limit=1",{headers:HEADERS})
      .then(function(r){return r.json();})
      .then(function(data){if(data&&data.length>0) setWasdeWheat(data[0]);})
      .catch(function(e){console.error("WASDE wheat error:",e);});
  }
  function loadCropCondition(){
    fetch(SUPABASE_URL+"/rest/v1/usda_conditions?commodity=eq.corn&order=created_at.desc&limit=1",{headers:HEADERS})
      .then(function(r){return r.json();})
      .then(function(data){
        if(data && data.length>0){
          setCropCondition({
            excellent: data[0].excellent_pct,
            good: data[0].good_pct,
            week: data[0].week_ending
          });
        }
      })
      .catch(function(e){console.error("USDA error:",e);});
  }
  var C={bg:"#0d1117",sb:"#0a0f1a",card:"#111827",border:"#1e2d45",text:"#f1f5f9",sub:"#7b8db0",muted:"#3d4f6e",blue:"#1B3A8C",purple:"#2d5ac8",green:"#5CB85C",red:"#f87171",amber:"#fbbf24",cyan:"#22d3ee",pink:"#6B7280"};

  function GCard(props){var label=props.label,value=props.value,unit=props.unit,gradient=props.gradient,delta=props.delta,pct=props.pct,mape=props.mape;var dc=delta===undefined?null:delta>0?C.green:delta<0?C.red:C.sub;return(<div style={{background:gradient||C.card,borderRadius:16,padding:"20px 22px",color:"#fff",position:"relative",overflow:"hidden",boxShadow:"0 4px 24px rgba(0,0,0,0.3)"}}><div style={{position:"absolute",top:-30,right:-30,width:100,height:100,borderRadius:"50%",background:"rgba(255,255,255,0.06)"}}/><div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",opacity:0.8,marginBottom:8}}>{label}</div><div style={{fontSize:28,fontWeight:900,lineHeight:1,marginBottom:4}}>{value}</div><div style={{fontSize:11,opacity:0.7}}>{unit}</div>{dc&&delta!==undefined&&<div style={{marginTop:8,fontSize:12,fontWeight:700,background:"rgba(255,255,255,0.15)",borderRadius:6,padding:"2px 8px",display:"inline-block"}}>{delta>0?"+":"-"}{fmt(Math.abs(delta))}{pct!==undefined?" ("+fmt(Math.abs(pct))+"%)":""}</div>}{mape!==undefined&&<div style={{marginTop:8,fontSize:11,opacity:0.85}}>MAPE: {mape!==null?mape.toFixed(2)+"%":"accumulating..."}</div>}</div>);}
  function FCard(props){var label=props.label,value=props.value,unit=props.unit,color=props.color,delta=props.delta,pct=props.pct,mape=props.mape;var dc=delta===undefined?C.sub:delta>0?C.green:delta<0?C.red:C.sub;return(<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"16px 18px",position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:"2px",background:color}}/><div style={{fontSize:10,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>{label}</div><div style={{fontSize:22,fontWeight:800,color:C.text,lineHeight:1,marginBottom:4}}>{value}</div><div style={{fontSize:11,color:C.muted}}>{unit}</div>{delta!==undefined&&<div style={{marginTop:6,fontSize:11,fontWeight:700,color:dc}}>{delta>0?"+":delta<0?"-":""}{fmt(Math.abs(delta))}{pct!==undefined?" ("+fmt(Math.abs(pct))+"%)":""}</div>}{mape!==undefined&&<div style={{marginTop:6,fontSize:10,color:mape!==null?(mape<2?C.green:mape<5?C.amber:C.red):C.muted}}>MAPE: {mape!==null?mape.toFixed(2)+"%":"accumulating..."}</div>}</div>);}

  function loadNews(){
    setNewsLoad(true);
    var apiKey = "b00e23b7c540f21999457d10e097d21f";
    var newsUrl = "https://gnews.io/api/v4/search?q=corn+futures+CBOT&lang=en&max=10&token=" + apiKey;
    var proxy = "https://corsproxy.io/?" + encodeURIComponent(newsUrl);
    fetch(proxy)
      .then(function(r){return r.json();})
      .then(function(data){
        if(data.articles) setNews(data.articles.map(function(a){
          return {
            title: a.title,
            link: a.url,
            pubDate: a.publishedAt,
            source: a.source ? a.source.name : "News"
          };
        }));
        setNewsLoad(false);
      })
      .catch(function(e){console.error("News error:",e);setNewsLoad(false);});
  }

  function exportToExcel(type){
    var XLSX = window.XLSX;
    
    // Sheet 1: Daily Prices
    var daily = [[
      'Date','CBOT Close (c/bu)','Open','High','Low','ARG Price (EGP)','BRZ Price (EGP)','Dollar Rate','CBOT Forecast','ARG Forecast','BRZ Forecast','MAPE CBOT%','MAPE ARG%','MAPE BRZ%'
    ],[
      L.date, L.closing_cbot, L.cbot_open, L.cbot_high, L.cbot_low,
      L.arg_price, L.brz_price, L.dollar_rate,
      L.cbot_predicted||'', L.arg_predicted||'', L.brz_predicted||'',
      L.mape_cbot||'', L.mape_arg||'', L.mape_brz||''
    ]];
    
    // Sheet 2: Weekly Forecast
    var wf = [['Date','CBOT Forecast (c/bu)','ARG Forecast (EGP)','BRZ Forecast (EGP)']];
    weekly.forEach(function(row){
      wf.push([row.forecast_date, row.cbot_forecast, row.arg_forecast, row.brz_forecast]);
    });
    
    var wb = XLSX.utils.book_new();
    if(type==="daily"){
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daily), "Daily Prices");
      XLSX.writeFile(wb, "AdmMedSofts_"+commodity+"_Daily_"+L.date+".xlsx");
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wf), "Weekly Forecast");
      XLSX.writeFile(wb, "AdmMedSofts_"+commodity+"_Forecast_"+L.date+".xlsx");
    }
  }

  function loadData(c){setLoading(true);fetch(SUPABASE_URL+"/rest/v1/commodity_prices?commodity=eq."+c+"&order=date.desc&limit=60",{headers:HEADERS}).then(function(r){return r.json();}).then(function(rows){setData(rows);setUpdated(new Date());setLoading(false);}).catch(function(e){console.error(e);setLoading(false);});}
  function loadWeekly(c){fetch(SUPABASE_URL+"/rest/v1/weekly_forecast?commodity=eq."+c+"&order=forecast_date.asc&limit=10",{headers:HEADERS}).then(function(r){return r.json();}).then(function(rows){setWeekly(rows);}).catch(function(e){console.error(e);});}
  useEffect(function(){
    var script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';
    document.head.appendChild(script);
    var script2 = document.createElement('script');
    script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    document.head.appendChild(script2);
  },[]);

  useEffect(function(){loadData(commodity);loadWeekly(commodity);loadWasde();if(commodity==="corn"){loadCropCondition();}var iv=setInterval(function(){loadData(commodity);},5*60*1000);return function(){clearInterval(iv);};},[commodity]);

  var L=data[0],P=data[1];
  var cbotD=L&&P?L.closing_cbot-P.closing_cbot:0,cbotPct=P&&P.closing_cbot?(cbotD/P.closing_cbot)*100:0,argD=L&&P?L.arg_price-P.arg_price:0;
  var prices=data.slice().reverse().map(function(d){return d.closing_cbot;}),dates=data.slice().reverse().map(function(d){return d.date?d.date.slice(5):"";});
  var ma7=calcMA(prices,7),ma21=calcMA(prices,21),rsiA=calcRSI(prices,14),bollA=calcBollinger(prices,20,2),macdA=calcMACD(prices);
  var sr=calcSR(prices),zs=calcZScore(prices),trend=getTrend(prices);
  var rsi=rsiA[rsiA.length-1],macd=macdA[macdA.length-1],boll=bollA[bollA.length-1];
  var rsiSig=rsi!==null?(rsi<30?"BUY":rsi>70?"SELL":"HOLD"):"HOLD";
  var macdSig=macd&&macd.macd!==null&&macd.signal!==null?(macd.macd>macd.signal?"BUY":"SELL"):"HOLD";
  var trendSig=trend==="bullish"?"BUY":trend==="bearish"?"SELL":"HOLD";
  var buys=[rsiSig,macdSig,trendSig].filter(function(s){return s==="BUY";}).length;
  var sells=[rsiSig,macdSig,trendSig].filter(function(s){return s==="SELL";}).length;
  var sig=buys>=2?"BUY":sells>=2?"SELL":"HOLD";
  var sigC=sig==="BUY"?C.green:sig==="SELL"?C.red:C.amber;
  var tC=trend==="bullish"?C.green:trend==="bearish"?C.red:C.amber;
  var cd=dates.map(function(date,i){return{date:date,close:prices[i]!==undefined?parseFloat(prices[i].toFixed(2)):null,ma7:ma7[i]!==null?parseFloat(ma7[i].toFixed(2)):null,ma21:ma21[i]!==null?parseFloat(ma21[i].toFixed(2)):null,upper:bollA[i].upper!==null?parseFloat(bollA[i].upper.toFixed(2)):null,lower:bollA[i].lower!==null?parseFloat(bollA[i].lower.toFixed(2)):null,rsi:rsiA[i]!==null?parseFloat(rsiA[i].toFixed(2)):null,histogram:macdA[i].histogram!==null?parseFloat(macdA[i].histogram.toFixed(4)):null,ret:data[data.length-1-i]&&data[data.length-1-i].fut_ret?parseFloat((data[data.length-1-i].fut_ret*100).toFixed(2)):null};});


  function generateWasdeReport(){
    var jsPDF = window.jspdf && window.jspdf.jsPDF;
    if(!jsPDF){ alert("PDF library still loading, please try again in a moment."); return; }
    var doc = new jsPDF({orientation:"portrait", unit:"mm", format:"a4"});
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var today = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
    var w = isWheat ? wasdeWheat : wasde;
    var comm = isWheat ? "Wheat" : "Corn";
    var ticker = isWheat ? "ZW=F" : "ZCN26.CBT";
    var cbot = L ? L.closing_cbot : 0;
    var predicted = L ? L.cbot_predicted : 0;
    var support = sr.support;
    var resistance = sr.resistance;
    var rsiVal = rsi ? rsi.toFixed(1) : "N/A";
    var macdDir = macd && macd.histogram ? (macd.histogram > 0 ? "positive (bullish)" : "negative (bearish)") : "N/A";
    var trendDesc = trend === "bullish" ? "uptrend" : trend === "bearish" ? "downtrend" : "sideways consolidation";
    var ge = w ? w.ge_condition : 0;
    var estYield = w ? w.estimated_yield : 0;
    var estProd = w ? w.estimated_production : 0;
    var prevProd = w ? w.prev_year_production : 0;
    var bullYield = w ? w.bullish_scenario_yield : 0;
    var bearYield = w ? w.bearish_scenario_yield : 0;
    var isBull = w && w.price_impact && w.price_impact.includes("BULL");
    var isBear = w && w.price_impact && w.price_impact.includes("BEAR");
    var bias = isBull ? "BULLISH" : isBear ? "BEARISH" : "NEUTRAL";
    var nextWasde = w ? w.report_date : "2026-07-11";
    var acres = w ? (w.planted_acres/1e6).toFixed(1) : "N/A";
    var neutral7Low=(cbot*0.985).toFixed(2),neutral7High=(cbot*1.015).toFixed(2);
    var neutral30Low=(cbot*0.970).toFixed(2),neutral30High=(cbot*1.010).toFixed(2);
    var bear7Low=(cbot*0.965).toFixed(2),bear7High=(cbot*0.985).toFixed(2);
    var bear30Low=(cbot*0.945).toFixed(2),bear30High=(cbot*0.975).toFixed(2);
    var bull7Low=(cbot*1.015).toFixed(2),bull7High=(cbot*1.040).toFixed(2);
    var bull30Low=(cbot*1.020).toFixed(2),bull30High=(cbot*1.060).toFixed(2);
    var pNeutral=isBull?30:isBear?30:40, pBear=isBull?20:isBear?45:35, pBull=isBull?50:isBear?25:25;
    var lm=14, rm=W-14, y=0;

    function addPage(){doc.addPage();y=20;doc.setDrawColor(200,200,200);doc.setLineWidth(0.3);doc.line(lm,15,rm,15);doc.setTextColor(150,150,150);doc.setFontSize(7.5);doc.setFont("helvetica","italic");doc.text("ADM MedSofts — "+comm+" Pre-WASDE Report | "+today,lm,12);doc.text("CONFIDENTIAL",rm,12,{align:"right"});}
    function checkY(n){if(y+n>H-20){addPage();}}
    function sectionTitle(txt){checkY(12);doc.setDrawColor(30,30,30);doc.setLineWidth(0.5);doc.line(lm,y,rm,y);y+=5;doc.setTextColor(15,15,15);doc.setFontSize(10.5);doc.setFont("helvetica","bold");doc.text(txt.toUpperCase(),lm,y);y+=6;doc.setDrawColor(200,200,200);doc.setLineWidth(0.2);doc.line(lm,y,rm,y);y+=5;}
    function bodyText(txt,indent){if(!indent)indent=0;var lines=doc.splitTextToSize(txt,rm-lm-indent);doc.setFontSize(9.5);doc.setFont("helvetica","normal");doc.setTextColor(40,40,40);lines.forEach(function(line){checkY(6);doc.text(line,lm+indent,y);y+=5.5;});y+=1;}
    function boldLabel(label,value){checkY(7);doc.setFontSize(9.5);doc.setFont("helvetica","bold");doc.setTextColor(15,15,15);doc.text(label,lm,y);var lw=doc.getTextWidth(label);doc.setFont("helvetica","normal");doc.setTextColor(40,40,40);doc.text(value,lm+lw+1,y);y+=6;}
    function bullet(txt){checkY(6);doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(40,40,40);doc.text("\u2022",lm+4,y);var lines=doc.splitTextToSize(txt,rm-lm-10);lines.forEach(function(line,i){doc.text(line,lm+9,y);if(i<lines.length-1){y+=5;checkY(6);}});y+=5.5;}
    function gap(n){y+=n||4;}

    // PAGE 1 HEADER
    doc.setFillColor(15,15,15);doc.rect(0,0,W,36,"F");
    doc.setTextColor(255,255,255);doc.setFontSize(16);doc.setFont("helvetica","bold");
    doc.text("ADM MedSofts Commodity Intelligence",W/2,12,{align:"center"});
    doc.setFontSize(13);doc.setFont("helvetica","normal");
    doc.text(comm.toUpperCase()+" — PRE-WASDE MARKET REPORT",W/2,21,{align:"center"});
    doc.setFontSize(8.5);doc.setTextColor(180,180,180);
    doc.text("Next WASDE: "+nextWasde+"   |   Generated: "+today+"   |   "+ticker,W/2,29,{align:"center"});
    var bc=isBull?[40,120,40]:isBear?[160,30,30]:[140,100,0];
    doc.setFillColor(bc[0],bc[1],bc[2]);doc.roundedRect(W/2-22,31,44,9,2,2,"F");
    doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont("helvetica","bold");
    doc.text("OVERALL BIAS: "+bias,W/2,37,{align:"center"});
    y=46;

    sectionTitle("Executive Summary");
    var prodVsPrev=estProd>prevProd?"above":estProd<prevProd?"below":"in line with";
    var prodDiff=Math.abs(estProd-prevProd).toFixed(2);
    bodyText("This report provides a pre-WASDE market analysis for "+comm+" futures ahead of the "+nextWasde+" USDA report release. Based on current USDA crop condition data, planted acreage figures, and our yield estimation model, the overall market bias is assessed as "+bias+".");
    gap();
    bodyText("Current CBOT "+comm+" futures ("+ticker+") are trading at "+cbot.toFixed(2)+" c/bu. Estimated production for 2026 stands at "+estProd+"B bushels, which is "+prodVsPrev+" last year's "+prevProd+"B bushels by "+prodDiff+"B bu. This "+(isBear?"supply-side pressure":"production outlook")+" represents the primary driver of our bias assessment.");

    gap(3);
    sectionTitle("USDA Crop Condition & Supply Estimates");
    boldLabel("Planted Acres:  ",acres+"M acres");
    boldLabel("Good + Excellent (G+E):  ",ge+"% of crop rated G/E");
    boldLabel("Estimated Yield:  ",estYield+" bu/acre");
    boldLabel("Estimated Production:  ",estProd+"B bushels");
    boldLabel("Previous Year Production:  ",prevProd+"B bushels");
    gap();
    var geDesc=ge>65?"above-average crop conditions, suggesting strong yield potential and bearish price pressure":ge>50?"near-average crop conditions with limited directional bias":"below-average crop conditions indicating potential yield stress and price support";
    bodyText("The current G+E rating of "+ge+"% reflects "+geDesc+". Our yield model estimates "+estYield+" bu/acre for the 2026 crop, derived from a base trend yield adjusted by +/- 0.5 bu/acre per percentage point deviation from historical average G+E.");
    if(cropCondition&&!isWheat){gap();boldLabel("USDA Weekly Conditions (week ending "+cropCondition.week+"):  ","Excellent: "+cropCondition.excellent+"%  |  Good: "+cropCondition.good+"%  |  G+E: "+(cropCondition.excellent+cropCondition.good)+"%");}

    gap(3);
    sectionTitle("Pre-WASDE Expectations");
    boldLabel("Key Focus:  ",isWheat?"Global wheat supply, Black Sea exports, U.S. winter wheat harvest":"U.S. ending stocks, South American production, feed demand");
    boldLabel("Yield Estimate:  ",estYield+" bu/acre");
    boldLabel("Production Estimate:  ",estProd+"B bu  ("+(estProd>prevProd?"above":"below")+" last year's "+prevProd+"B bu)");
    gap();
    bodyText("The market will closely watch whether USDA confirms, raises, or cuts its "+comm.toLowerCase()+" production estimates. "+(isBear?"Given the bearish supply backdrop, any upward revision to production or stocks would extend selling pressure. A downward revision would be required to shift sentiment.":isBull?"Given the tighter supply outlook, any downward revision to production or confirmation of crop stress would support prices.":"The market is balanced near current levels. Directional bias will depend on whether USDA surprises to the upside or downside relative to trade expectations."));

    // PAGE 2
    addPage();
    sectionTitle("Scenarios for WASDE Reaction");
    doc.setFontSize(10);doc.setFont("helvetica","bold");doc.setTextColor(100,80,0);
    doc.text("SCENARIO 1: NEUTRAL ("+pNeutral+"% probability)",lm,y);y+=6;
    doc.setDrawColor(200,170,0);doc.setLineWidth(0.3);doc.line(lm,y,rm,y);y+=4;
    bodyText("If "+comm.toLowerCase()+" production/stocks come in broadly in line with current expectations:");
    bullet("Initial reaction: -2 to +2 c/bu (minimal move)");
    bullet("Short-term direction: Sideways to slightly "+(isBear?"lower":"higher"));
    bullet("7-day price target: "+neutral7Low+" – "+neutral7High+" c/bu");
    bullet("30-day price target: "+neutral30Low+" – "+neutral30High+" c/bu");
    bullet("Key: Focus shifts to "+(isWheat?"global export pace and Black Sea developments":"export sales data and South American weather"));
    gap(3);

    doc.setFontSize(10);doc.setFont("helvetica","bold");doc.setTextColor(160,30,30);
    doc.text("SCENARIO 2: BEARISH SURPRISE ("+pBear+"% probability)",lm,y);y+=6;
    doc.setDrawColor(200,80,80);doc.setLineWidth(0.3);doc.line(lm,y,rm,y);y+=4;
    bodyText("If USDA raises production/stocks above current estimates (yield at "+bearYield+" bu/acre or higher):");
    bullet("Initial reaction: -5 to -10 c/bu");
    bullet("Short-term direction: Continued downward pressure");
    bullet("7-day price target: "+bear7Low+" – "+bear7High+" c/bu");
    bullet("30-day price target: "+bear30Low+" – "+bear30High+" c/bu");
    bullet("Risk: Test of recent support at "+support.toFixed(2)+" c/bu");
    bullet("Catalyst: "+(isWheat?"Strong global harvest + weak import demand":"Large South American crop + weak feed/residual demand"));
    gap(3);

    doc.setFontSize(10);doc.setFont("helvetica","bold");doc.setTextColor(30,120,30);
    doc.text("SCENARIO 3: BULLISH SURPRISE ("+pBull+"% probability)",lm,y);y+=6;
    doc.setDrawColor(60,160,60);doc.setLineWidth(0.3);doc.line(lm,y,rm,y);y+=4;
    bodyText("If USDA cuts production/stocks below current estimates (yield at "+bullYield+" bu/acre or lower):");
    bullet("Initial reaction: +5 to +12 c/bu");
    bullet("Short-term direction: Rally extension");
    bullet("7-day price target: "+bull7Low+" – "+bull7High+" c/bu");
    bullet("30-day price target: "+bull30Low+" – "+bull30High+" c/bu");
    bullet("Catalyst: "+(isWheat?"Frost/drought damage to winter wheat crop":"Weather stress in key growing regions + export surge"));
    bullet("Key resistance: "+resistance.toFixed(2)+" c/bu");
    gap(3);

    sectionTitle("Technical Analysis");
    boldLabel("Current CBOT Price:  ",cbot.toFixed(2)+" c/bu  ("+ticker+")");
    boldLabel("Next-Day Model Forecast:  ",predicted?predicted.toFixed(2)+" c/bu":"N/A");
    boldLabel("Trend:  ",trend.charAt(0).toUpperCase()+trend.slice(1)+" — "+trendDesc);
    boldLabel("RSI (14):  ",rsiVal+" — "+rsiSig+(rsi?(rsi<30?" (oversold)":rsi>70?" (overbought)":" (neutral)"):""));
    boldLabel("MACD:  ",macdDir);
    boldLabel("Z-Score:  ",zs.toFixed(2)+(Math.abs(zs)>2?" — STATISTICALLY EXTREME":" — within normal range"));
    boldLabel("Support:  ",support.toFixed(2)+" c/bu");
    boldLabel("Resistance:  ",resistance.toFixed(2)+" c/bu");
    if(boll&&boll.upper){boldLabel("Bollinger Bands:  ","Upper: "+boll.upper.toFixed(2)+"  Lower: "+boll.lower.toFixed(2)+(cbot>boll.upper?"  — Above upper band":cbot<boll.lower?"  — Below lower band":"  — Inside bands"));}
    gap();
    bodyText("From a technical perspective, the "+comm.toLowerCase()+" market is currently "+(sig==="BUY"?"showing bullish signals with "+buys+" out of 3 indicators pointing higher. Watch for a sustained break above resistance at "+resistance.toFixed(2)+" c/bu.":sig==="SELL"?"showing bearish signals with "+sells+" out of 3 indicators pointing lower. Key support at "+support.toFixed(2)+" c/bu should be monitored closely.":"in a mixed technical state. A breakout above "+resistance.toFixed(2)+" or break below "+support.toFixed(2)+" c/bu will determine the next move."));

    // PAGE 3
    addPage();
    sectionTitle("Current Market Prices (EGP)");
    if(L){
      var p1l=isWheat?"11.5% Protein Wheat":"ARG Origin Corn", p2l=isWheat?"12.5% Protein Wheat":"BRZ Origin Corn";
      boldLabel("Dollar Rate:  ",L.dollar_rate.toFixed(2)+" EGP/USD");
      boldLabel(p1l+":  ",Math.round(L.arg_price).toLocaleString()+" EGP/MT");
      boldLabel(p2l+":  ",Math.round(L.brz_price).toLocaleString()+" EGP/MT");
      if(L.arg_predicted)boldLabel(p1l+" Forecast:  ",Math.round(L.arg_predicted).toLocaleString()+" EGP/MT");
      if(L.brz_predicted)boldLabel(p2l+" Forecast:  ",Math.round(L.brz_predicted).toLocaleString()+" EGP/MT");
      gap();
      bodyText("Local EGP prices are derived from CBOT futures converted at "+L.dollar_rate.toFixed(2)+" EGP/USD, "+(isWheat?"adjusted by the formula: ((CBOT/100) × 36.74 + 25) × Dollar Rate + 459.":"adjusted via Ridge Regression model trained on historical Supply & Demand data."));
    }

    gap(3);
    sectionTitle("Longer-Term Outlook");
    var ltBias=isBear?"bearish":isBull?"bullish":"neutral";
    bodyText("The fundamental medium-term bias for "+comm+" is "+ltBias+" heading into the July WASDE cycle. "+(isBear?"Above-average production estimates combined with "+(isWheat?"strong global supply from the Black Sea region":"large South American crops and strong Brazilian competition")+" are capping upside potential. Demand growth has not kept pace with the supply increase.":isBull?"Below-trend crop conditions and potential yield stress provide a supportive floor for prices. Any weather deterioration in key growing regions could accelerate the rally.":"The market is balanced between adequate supply and steady demand. Price direction will depend on whether crop conditions improve or deteriorate through the critical growing season."));
    gap();
    boldLabel("Expected trading range (next 30-60 days):  ",(cbot*0.93).toFixed(2)+" – "+(cbot*1.08).toFixed(2)+" c/bu");
    boldLabel("Key support:  ",support.toFixed(2)+" c/bu");
    boldLabel("Key resistance:  ",resistance.toFixed(2)+" c/bu");
    gap();
    bodyText("Key catalysts to watch: "+(isWheat?"Global export tenders, Black Sea shipping, EU/Russia crop conditions, U.S. winter wheat harvest progress, and import demand shifts from Egypt and major buyers.":"Weekly USDA export inspections, South American harvest pace, U.S. growing season weather, ethanol demand data, and China purchasing activity."));

    gap(3);
    sectionTitle("Pre-Report Positioning Notes");
    bullet("Volatility is expected to spike around the "+nextWasde+" WASDE release (12:00 PM ET).");
    bullet("Options premiums may be elevated ahead of the report — consider implied move when sizing.");
    bullet("Wait for post-report clarity before establishing directional positions if risk tolerance is low.");
    bullet("If positioned, use defined stops — report-day moves of 10-20+ c/bu are not uncommon.");
    bullet("Local EGP buyers should monitor the dollar rate alongside CBOT for full price impact.");

    var footY=H-12;
    doc.setDrawColor(180,180,180);doc.setLineWidth(0.3);doc.line(lm,footY-4,rm,footY-4);
    doc.setTextColor(130,130,130);doc.setFontSize(7.5);doc.setFont("helvetica","italic");
    doc.text("ADM MedSofts Commodity Intelligence — CONFIDENTIAL",W/2,footY,{align:"center"});
    doc.text("Generated from statistical forecast models and USDA public data. Not sole trading advice.",W/2,footY+4,{align:"center"});

    doc.save("AdmMedSofts_PreWASDE_"+comm+"_"+today.replace(/ /g,"_")+".pdf");
  }

  function runAI(){setAiLoad(true);setAi("");setTab("analysis");setTimeout(function(){setAi(report());setAiLoad(false);},800);}
  function report(){if(!L||prices.length<5)return "Not enough data.";var lines=[],c=L.closing_cbot,p5=prices.slice(-6,-1),pct5=((c-p5[0])/p5[0]*100);lines.push("PRICE SUMMARY — "+L.date);lines.push("─────────────────────────");if(cbotD>0)lines.push("UP "+Math.abs(cbotD).toFixed(2)+" ("+Math.abs(cbotPct).toFixed(2)+"%) — "+c.toFixed(2)+" ¢/bu");else if(cbotD<0)lines.push("DOWN "+Math.abs(cbotD).toFixed(2)+" ("+Math.abs(cbotPct).toFixed(2)+"%) — "+c.toFixed(2)+" ¢/bu");else lines.push("FLAT — "+c.toFixed(2)+" ¢/bu");lines.push("5-session: "+(pct5>=0?"+":"")+pct5.toFixed(2)+"%");lines.push("");lines.push("TECHNICAL INDICATORS");lines.push("─────────────────────────");if(rsi!==null){var r="RSI(14) = "+rsi.toFixed(1)+" — ";if(rsi<30)r+="OVERSOLD";else if(rsi<45)r+="Bearish";else if(rsi<55)r+="Neutral";else if(rsi<70)r+="Bullish";else r+="OVERBOUGHT";lines.push(r);}if(macd&&macd.histogram!==null)lines.push("MACD = "+macd.histogram.toFixed(4)+" — "+(macd.histogram>0?"Bullish":"Bearish"));lines.push("Z-Score = "+zs.toFixed(2)+(Math.abs(zs)>2?" EXTREME!":""));var m7=ma7[ma7.length-1],m21=ma21[ma21.length-1];if(m7&&m21)lines.push("MA7="+m7.toFixed(2)+" MA21="+m21.toFixed(2)+" — "+(m7>m21?"Bullish":"Bearish"));lines.push("");lines.push("KEY LEVELS");lines.push("─────────────────────────");lines.push("Support: "+sr.support.toFixed(2)+" | Resistance: "+sr.resistance.toFixed(2));lines.push("");lines.push("LOCAL (EGP)");lines.push("─────────────────────────");lines.push("Dollar: "+L.dollar_rate.toFixed(2)+" | "+(isWheat?"11.5%":"ARG")+": "+Math.round(L.arg_price).toLocaleString()+" | "+(isWheat?"12.5%":"BRZ")+": "+Math.round(L.brz_price).toLocaleString());lines.push("");lines.push("SIGNAL: "+sig+" ("+buys+"B/"+sells+"S)");if(sig==="BUY")lines.push("Bullish. Watch R: "+sr.resistance.toFixed(2));else if(sig==="SELL")lines.push("Bearish. Watch S: "+sr.support.toFixed(2));else lines.push("Mixed. Wait for breakout.");return lines.join("\n");}

  var alerts=[];
  if(L&&Math.abs(cbotPct)>=5) alerts.push({type:"danger",msg:"EXTREME MOVE: "+fmt(Math.abs(cbotPct))+"% — Unusual price activity!"});
  else if(L&&Math.abs(cbotPct)>=2) alerts.push({type:"warning",msg:"Large Move: "+fmt(Math.abs(cbotPct))+"% — Monitor closely."});
  if(rsi!==null&&rsi<25) alerts.push({type:"success",msg:"RSI Extreme Oversold ("+rsi.toFixed(1)+") — Potential bounce."});
  if(rsi!==null&&rsi>75) alerts.push({type:"danger",msg:"RSI Extreme Overbought ("+rsi.toFixed(1)+") — Pullback risk."});
  if(Math.abs(zs)>2.5) alerts.push({type:"danger",msg:"Z-Score Alert ("+zs.toFixed(2)+") — Statistically extreme move!"});
  if(L&&sr&&L.closing_cbot<sr.support*1.005) alerts.push({type:"danger",msg:"Testing Support at "+fmt(sr.support)+" — Break below could accelerate selling."});
  if(L&&sr&&L.closing_cbot>sr.resistance*0.995) alerts.push({type:"warning",msg:"Testing Resistance at "+fmt(sr.resistance)+" — Watch for breakout."});

  var cc=COMMODITIES.find(function(c){return c.id===commodity;});
  var isWheat = commodity === "wheat";
  var label1 = isWheat ? "11.5% Price" : "ARG Local Price";
  var label2 = isWheat ? "12.5% Price" : "BRZ Price";
  var label3 = isWheat ? "11.5% Forecast" : "ARG Forecast";
  var label4 = isWheat ? "12.5% Forecast" : "BRZ Forecast";
  var nav=[["overview","Overview"],["charts","Charts"],["analysis","AI Analysis"],["returns","Returns"],["table","Raw Data"],["weekly","Weekly Forecast"],["news","Market News"]];

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter','DM Sans','Segoe UI',sans-serif",display:"flex"}}>
      <div style={{width:230,minHeight:"100vh",background:C.sb,display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,bottom:0,overflowY:"auto",borderRight:"1px solid "+C.border}}>
        <div style={{padding:"22px 20px 18px",borderBottom:"1px solid "+C.border}}><div style={{display:"flex",alignItems:"center",gap:12}}><div><img src="/media.jpg" alt="ADM MedSofts" style={{height:32,objectFit:"contain",filter:"none"}}/><div style={{fontSize:10,color:C.sub,marginTop:2}}>Commodity Intelligence</div></div></div></div>
        <div style={{padding:"18px 14px 8px"}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:10,paddingLeft:6}}>Markets</div>{COMMODITIES.map(function(c){var active=commodity===c.id;return(<button key={c.id} onClick={function(){setCommodity(c.id);}} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",borderRadius:8,border:"none",cursor:"pointer",marginBottom:2,background:active?"linear-gradient(135deg,rgba(79,142,247,0.2),rgba(157,124,248,0.1))":"transparent",color:active?C.blue:C.sub,fontWeight:active?700:400,fontSize:13,textAlign:"left",borderLeft:active?"3px solid "+C.blue:"3px solid transparent"}}><span>{c.label}</span>{c.id==="soybeans"&&<span style={{fontSize:9,color:C.muted,border:"1px solid "+C.border,padding:"1px 7px",borderRadius:5}}>Soon</span>}</button>);})}</div>
        <div style={{padding:"8px 14px"}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:10,paddingLeft:6}}>Views</div>{nav.map(function(item){var id=item[0],label=item[1],active=tab===id;return(<button key={id} onClick={function(){setTab(id);}} style={{width:"100%",padding:"7px 12px",borderRadius:8,border:"none",cursor:"pointer",marginBottom:2,background:active?"linear-gradient(135deg,rgba(79,142,247,0.2),rgba(157,124,248,0.1))":"transparent",color:active?C.blue:C.sub,fontWeight:active?700:400,fontSize:13,textAlign:"left",borderLeft:active?"3px solid "+C.blue:"3px solid transparent"}}>{label}</button>);})}</div>
        <div style={{marginTop:"auto",padding:"14px 14px 20px",borderTop:"1px solid "+C.border}}><button onClick={function(){loadData(commodity);loadWeekly(commodity);}} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid "+C.border,background:"transparent",color:C.sub,fontSize:11,cursor:"pointer",marginBottom:8,textAlign:"left",fontWeight:500}}>Refresh Data</button><button onClick={function(){exportToExcel("daily");}} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid rgba(92,184,92,0.5)",background:"rgba(92,184,92,0.08)",color:C.green,fontSize:11,cursor:"pointer",marginBottom:6,textAlign:"left",fontWeight:600}}>Export Daily Prices</button><button onClick={function(){exportToExcel("forecast");}} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"1px solid rgba(92,184,92,0.5)",background:"rgba(92,184,92,0.08)",color:C.green,fontSize:11,cursor:"pointer",marginBottom:10,textAlign:"left",fontWeight:600}}>Export Weekly Forecast</button><button onClick={runAI} style={{width:"100%",padding:"9px 12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,"+C.blue+","+C.purple+")",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:700,boxShadow:"0 4px 16px rgba(79,142,247,0.35)"}}>Run AI Analysis</button>{updated&&<div style={{fontSize:9,color:C.muted,marginTop:10,textAlign:"center"}}>Updated {updated.toLocaleTimeString()}</div>}</div>
      </div>
      <div style={{marginLeft:230,flex:1,padding:"28px 32px",minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}><div><h1 style={{fontSize:24,fontWeight:900,margin:0,color:C.text,letterSpacing:"-0.5px"}}>{cc?cc.label:""} Market</h1><div style={{fontSize:12,color:C.sub,marginTop:4}}>CBOT Futures · EGP Local Prices · {L?L.date:"—"}</div></div><div style={{display:"flex",gap:8,alignItems:"center"}}>
            
            <div style={{background:trend==="bullish"?"rgba(52,211,153,0.12)":trend==="bearish"?"rgba(248,113,113,0.12)":"rgba(251,191,36,0.12)",border:"1px solid "+(trend==="bullish"?"rgba(52,211,153,0.3)":trend==="bearish"?"rgba(248,113,113,0.3)":"rgba(251,191,36,0.3)"),borderRadius:10,padding:"7px 14px",fontSize:12,color:tC,fontWeight:700}}>{trend==="bullish"?"Bullish":trend==="bearish"?"Bearish":"Neutral"}</div>
            <div style={{position:"relative"}}>
              <button onClick={function(){setShowAlerts(!showAlerts);}} style={{position:"relative",width:38,height:38,borderRadius:10,border:"1px solid "+(alerts.length>0?C.red:C.border),background:alerts.length>0?"rgba(248,113,113,0.1)":C.card,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
                🔔
                {alerts.length>0&&<div style={{position:"absolute",top:-4,right:-4,width:18,height:18,borderRadius:"50%",background:C.red,color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{alerts.length}</div>}
              </button>
              {showAlerts&&<div style={{position:"absolute",top:44,right:0,width:320,background:C.card,border:"1px solid "+C.border,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",zIndex:1000,overflow:"hidden"}}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>Alerts</div>
                  <button onClick={function(){setShowAlerts(false);}} style={{border:"none",background:"transparent",color:C.sub,cursor:"pointer",fontSize:16}}>×</button>
                </div>
                {alerts.length===0?(
                  <div style={{padding:"16px",textAlign:"center",color:C.sub,fontSize:12}}>No active alerts</div>
                ):alerts.map(function(a,i){
                  var color=a.type==="danger"?C.red:a.type==="warning"?C.amber:C.green;
                  var bg=a.type==="danger"?"rgba(248,113,113,0.08)":a.type==="warning"?"rgba(251,191,36,0.08)":"rgba(52,211,153,0.08)";
                  return(<div key={i} style={{padding:"12px 16px",borderTop:i===0?"none":"1px solid "+C.border,background:bg}}>
                    <div style={{fontSize:11,fontWeight:700,color:color,marginBottom:3}}>{a.type==="danger"?"ALERT":a.type==="warning"?"WARNING":"INFO"}</div>
                    <div style={{fontSize:12,color:C.text}}>{a.msg}</div>
                  </div>);
                })}
              </div>}
            </div>
          </div></div>
        {loading?(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,color:C.sub}}>Loading...</div>):!L?(<div style={{textAlign:"center",padding:80,color:C.sub}}>No data</div>):(
          <div>
            {(tab==="overview"||tab==="charts"||tab==="analysis")&&(<div style={{marginBottom:20}}><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:14}}><GCard label="CBOT Close" value={fmt(L.closing_cbot)} unit="cents / bushel" gradient={"linear-gradient(135deg,"+C.blue+","+C.purple+")"} delta={cbotD} pct={cbotPct}/><GCard label={label1} value={fmtK(L.arg_price)} unit="Egyptian Pound" gradient={"linear-gradient(135deg,"+C.green+",#059669)"} delta={argD}/><GCard label={label2} value={fmtK(L.brz_price)} unit="Egyptian Pound" gradient={"linear-gradient(135deg,"+C.amber+",#d97706)"}/><GCard label="Dollar Rate" value={fmt(L.dollar_rate)} unit="EGP / USD" gradient={"linear-gradient(135deg,"+C.pink+","+C.purple+")"}/>
            </div><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:12,marginBottom:14}}>{[
                    {label:"Open",value:fmt(L.cbot_open),color:C.sub},
                    {label:"High",value:fmt(L.cbot_high),color:C.green},
                    {label:"Low",value:fmt(L.cbot_low),color:C.red},
                    {label:"Close",value:fmt(L.closing_cbot),color:C.blue},
                    {label:"Pred. Open",value:L.predicted_open?fmt(L.predicted_open):"—",color:C.sub},{label:"Pred. High",value:L.predicted_high?fmt(L.predicted_high):"—",color:C.green},{label:"Pred. Low",value:L.predicted_low?fmt(L.predicted_low):"—",color:C.red},{label:"Pred. Close",value:L.cbot_predicted?fmt(L.cbot_predicted):"—",color:C.blue,mape:L.mape_cbot},
                    {label:label3,value:L.arg_predicted?fmtK(L.arg_predicted):"—",color:C.green,mape:L.mape_arg},
                    {label:label4,value:L.brz_predicted?fmtK(L.brz_predicted):"—",color:C.amber,mape:L.mape_brz},
                  ].map(function(item,i){return(
                    <div key={i} style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"14px 16px",borderTop:"2px solid "+item.color}}>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{item.label}</div>
                      <div style={{fontSize:18,fontWeight:800,color:item.color,fontVariantNumeric:"tabular-nums"}}>{item.value}</div>
                      {item.mape!==undefined&&<div style={{fontSize:10,color:item.mape!==null?(item.mape<2?C.green:item.mape<5?C.amber:C.red):C.muted,marginTop:4}}>MAPE: {item.mape!==null?item.mape.toFixed(2)+"%":"accumulating..."}</div>}
                    </div>
                  );})}</div></div>)}
            {tab==="overview"&&(<div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,padding:"20px 22px 14px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><div style={{fontSize:13,fontWeight:700,color:C.text}}>CBOT Price Trend</div><div style={{display:"flex",gap:14,fontSize:11,color:C.sub}}><span><span style={{display:"inline-block",width:12,height:2,background:C.blue,borderRadius:2,marginRight:5,verticalAlign:"middle"}}></span>Close</span><span><span style={{display:"inline-block",width:12,height:2,background:C.amber,borderRadius:2,marginRight:5,verticalAlign:"middle"}}></span>MA7</span><span><span style={{display:"inline-block",width:12,height:2,background:C.purple,borderRadius:2,marginRight:5,verticalAlign:"middle"}}></span>MA21</span></div></div><ResponsiveContainer width="100%" height={230}><AreaChart data={cd}><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.blue} stopOpacity={0.2}/><stop offset="95%" stopColor={C.blue} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="date" tick={{fill:C.sub,fontSize:10}}/><YAxis tick={{fill:C.sub,fontSize:10}} domain={["auto","auto"]}/><Tooltip content={<TT/>}/><Area type="monotone" dataKey="close" stroke={C.blue} strokeWidth={2.5} fill="url(#bg1)" dot={false} name="Close"/><Line type="monotone" dataKey="ma7" stroke={C.amber} strokeWidth={1.5} dot={false} name="MA7" strokeDasharray="5 3"/><Line type="monotone" dataKey="ma21" stroke={C.purple} strokeWidth={1.5} dot={false} name="MA21" strokeDasharray="5 3"/></AreaChart></ResponsiveContainer></div><div style={{display:"flex",flexDirection:"column",gap:10}}>{[{label:"Overall Signal",value:sig,color:sigC,sub:buys+" buy / "+sells+" sell"},{label:"RSI (14)",value:rsi?rsi.toFixed(1):"—",color:rsi?(rsi<30?C.green:rsi>70?C.red:C.amber):C.amber,sub:rsi?(rsi<30?"Oversold":rsi>70?"Overbought":"Neutral"):""},{label:"Z-Score",value:zs.toFixed(2),color:Math.abs(zs)>2?C.red:C.cyan,sub:Math.abs(zs)>2?"Extreme":"Normal"},{label:"Support",value:fmt(sr.support),color:C.green,sub:"cents/bu floor"},{label:"Resistance",value:fmt(sr.resistance),color:C.red,sub:"cents/bu ceiling"}].map(function(item,i){return(<div key={i} style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"12px 16px",flex:1}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>{item.label}</div><div style={{fontSize:20,fontWeight:800,color:item.color,marginTop:3}}>{item.value}</div><div style={{fontSize:10,color:C.sub}}>{item.sub}</div></div>);})}</div></div>)}
            {tab==="charts"&&(<div style={{display:"flex",flexDirection:"column",gap:16}}><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,padding:"20px 22px 14px"}}><div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:16}}>Price + Bollinger Bands</div><ResponsiveContainer width="100%" height={250}><LineChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="date" tick={{fill:C.sub,fontSize:10}}/><YAxis tick={{fill:C.sub,fontSize:10}} domain={["auto","auto"]}/><Tooltip content={<TT/>}/><Line type="monotone" dataKey="upper" stroke={C.cyan} strokeWidth={1} dot={false} name="BB Upper" strokeDasharray="3 3"/><Line type="monotone" dataKey="close" stroke={C.blue} strokeWidth={2.5} dot={false} name="Close"/><Line type="monotone" dataKey="lower" stroke={C.red} strokeWidth={1} dot={false} name="BB Lower" strokeDasharray="3 3"/><ReferenceLine y={sr.support} stroke={C.green} strokeDasharray="5 5" label={{value:"S",fill:C.green,fontSize:9}}/><ReferenceLine y={sr.resistance} stroke={C.red} strokeDasharray="5 5" label={{value:"R",fill:C.red,fontSize:9}}/></LineChart></ResponsiveContainer></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,padding:"20px 22px 14px"}}><div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14}}>RSI (14)</div><ResponsiveContainer width="100%" height={170}><AreaChart data={cd}><defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.amber} stopOpacity={0.2}/><stop offset="95%" stopColor={C.amber} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="date" tick={{fill:C.sub,fontSize:9}}/><YAxis domain={[0,100]} tick={{fill:C.sub,fontSize:9}}/><Tooltip content={<TT/>}/><ReferenceLine y={70} stroke={C.red} strokeDasharray="4 4"/><ReferenceLine y={30} stroke={C.green} strokeDasharray="4 4"/><Area type="monotone" dataKey="rsi" stroke={C.amber} strokeWidth={2} fill="url(#rg)" dot={false} name="RSI"/></AreaChart></ResponsiveContainer></div><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,padding:"20px 22px 14px"}}><div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14}}>MACD</div><ResponsiveContainer width="100%" height={170}><BarChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="date" tick={{fill:C.sub,fontSize:9}}/><YAxis tick={{fill:C.sub,fontSize:9}}/><Tooltip content={<TT/>}/><ReferenceLine y={0} stroke={C.border} strokeWidth={2}/><Bar dataKey="histogram" name="MACD" fill={C.purple} radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div></div></div>)}
            {tab==="analysis"&&(<div style={{display:"flex",flexDirection:"column",gap:14}}>{wasde&&commodity==="corn"&&<div style={{background:"rgba(27,58,140,0.08)",border:"1px solid rgba(27,58,140,0.3)",borderRadius:12,padding:"16px 20px",marginBottom:4}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:13,fontWeight:700,color:C.blue}}>📊 PRE-WASDE ANALYSIS — Next Report: {wasde.report_date}</div><div style={{fontSize:11,padding:"3px 10px",borderRadius:6,fontWeight:700,background:wasde.price_impact&&wasde.price_impact.includes("BULL")?"rgba(92,184,92,0.15)":wasde.price_impact&&wasde.price_impact.includes("BEAR")?"rgba(248,113,113,0.15)":"rgba(251,191,36,0.15)",color:wasde.price_impact&&wasde.price_impact.includes("BULL")?C.green:wasde.price_impact&&wasde.price_impact.includes("BEAR")?C.red:C.amber}}>{wasde.price_impact&&wasde.price_impact.split(" - ")[0]}</div></div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>{[{label:"Planted Acres",value:wasde.planted_acres?(wasde.planted_acres/1e6).toFixed(1)+"M":"—"},{label:"G+E Condition",value:wasde.ge_condition?wasde.ge_condition+"%":"—"},{label:"Est. Yield",value:wasde.estimated_yield?wasde.estimated_yield+" bu/ac":"—"},{label:"Est. Production",value:wasde.estimated_production?wasde.estimated_production+"B bu":"—"}].map(function(item,i){return(<div key={i} style={{background:C.card,borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:C.sub,fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{item.label}</div><div style={{fontSize:14,fontWeight:700,color:C.text}}>{item.value}</div></div>);})}</div><div style={{fontSize:12,color:C.text,lineHeight:1.6}}>{wasde.price_impact&&wasde.price_impact.split(" - ")[1]}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}><div style={{background:"rgba(92,184,92,0.08)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:C.green,fontWeight:700,marginBottom:4}}>BULLISH SCENARIO</div><div style={{fontSize:12,color:C.text}}>Yield drops to {wasde.bullish_scenario_yield} bu/ac (weather stress) → prices rally</div></div><div style={{background:"rgba(248,113,113,0.08)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:4}}>BEARISH SCENARIO</div><div style={{fontSize:12,color:C.text}}>Yield rises to {wasde.bearish_scenario_yield} bu/ac (perfect weather) → prices fall</div></div></div></div>}{wasdeWheat&&commodity==="wheat"&&<div style={{background:"rgba(27,58,140,0.08)",border:"1px solid rgba(27,58,140,0.3)",borderRadius:12,padding:"16px 20px",marginBottom:4}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:13,fontWeight:700,color:C.blue}}>🌾 PRE-WASDE ANALYSIS — Next Report: {wasdeWheat.report_date}</div><div style={{fontSize:11,padding:"3px 10px",borderRadius:6,fontWeight:700,background:wasdeWheat.price_impact&&wasdeWheat.price_impact.includes("BULL")?"rgba(92,184,92,0.15)":wasdeWheat.price_impact&&wasdeWheat.price_impact.includes("BEAR")?"rgba(248,113,113,0.15)":"rgba(251,191,36,0.15)",color:wasdeWheat.price_impact&&wasdeWheat.price_impact.includes("BULL")?C.green:wasdeWheat.price_impact&&wasdeWheat.price_impact.includes("BEAR")?C.red:C.amber}}>{wasdeWheat.price_impact&&wasdeWheat.price_impact.split(" - ")[0]}</div></div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>{[{label:"Planted Acres",value:wasdeWheat.planted_acres?(wasdeWheat.planted_acres/1e6).toFixed(1)+"M":"—"},{label:"G+E Condition",value:wasdeWheat.ge_condition?wasdeWheat.ge_condition+"%":"—"},{label:"Est. Yield",value:wasdeWheat.estimated_yield?wasdeWheat.estimated_yield+" bu/ac":"—"},{label:"Est. Production",value:wasdeWheat.estimated_production?wasdeWheat.estimated_production+"B bu":"—"}].map(function(item,i){return(<div key={i} style={{background:C.card,borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:C.sub,fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{item.label}</div><div style={{fontSize:14,fontWeight:700,color:C.text}}>{item.value}</div></div>);})}</div><div style={{fontSize:12,color:C.text,lineHeight:1.6}}>{wasdeWheat.price_impact&&wasdeWheat.price_impact.split(" - ")[1]}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}><div style={{background:"rgba(92,184,92,0.08)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:C.green,fontWeight:700,marginBottom:4}}>BULLISH SCENARIO</div><div style={{fontSize:12,color:C.text}}>Yield drops to {wasdeWheat.bullish_scenario_yield} bu/ac (drought/freeze) → prices rally</div></div><div style={{background:"rgba(248,113,113,0.08)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:4}}>BEARISH SCENARIO</div><div style={{fontSize:12,color:C.text}}>Yield rises to {wasdeWheat.bearish_scenario_yield} bu/ac (ideal harvest) → prices fall</div></div></div></div>}{(wasde&&commodity==="corn"||wasdeWheat&&commodity==="wheat")&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}><button onClick={generateWasdeReport} style={{padding:"9px 20px",borderRadius:10,border:"1px solid #1B3A8C",background:"rgba(27,58,140,0.15)",color:"#f1f5f9",fontSize:12,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:8}}>📄 Generate Pre-WASDE PDF Report</button></div>}{cropCondition&&commodity==="corn"&&<div style={{background:"rgba(92,184,92,0.08)",border:"1px solid rgba(92,184,92,0.3)",borderRadius:12,padding:"12px 16px",display:"flex",gap:24,alignItems:"center"}}><div style={{fontSize:12,fontWeight:700,color:C.green}}>USDA CROP CONDITIONS</div><div style={{fontSize:12,color:C.text}}>Excellent: <span style={{fontWeight:700,color:C.green}}>{cropCondition.excellent}%</span></div><div style={{fontSize:12,color:C.text}}>Good: <span style={{fontWeight:700,color:C.blue}}>{cropCondition.good}%</span></div><div style={{fontSize:11,color:C.sub}}>Week ending {cropCondition.week}</div></div>}<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>{[{label:"Overall",value:sig,color:sigC,sub:buys+"B/"+sells+"S"},{label:"RSI Signal",value:rsiSig,color:rsiSig==="BUY"?C.green:rsiSig==="SELL"?C.red:C.amber,sub:"RSI="+(rsi?rsi.toFixed(1):"—")},{label:"MACD Signal",value:macdSig,color:macdSig==="BUY"?C.green:macdSig==="SELL"?C.red:C.amber,sub:macd&&macd.histogram?(macd.histogram>0?"Mom+":"Mom-"):"—"},{label:"Trend",value:trendSig,color:trendSig==="BUY"?C.green:trendSig==="SELL"?C.red:C.amber,sub:trend}].map(function(c,i){return(<div key={i} style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"18px 20px",textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>{c.label}</div><div style={{fontSize:18,fontWeight:800,color:c.color,border:"1px solid "+c.color+"50",display:"inline-block",padding:"4px 16px",borderRadius:8,marginBottom:8}}>{c.value}</div><div style={{fontSize:11,color:C.sub}}>{c.sub}</div></div>);})}</div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>{[{label:"Z-Score",value:zs.toFixed(2),color:Math.abs(zs)>2?C.red:C.cyan,sub:Math.abs(zs)>2?"Extreme":"Normal"},{label:"Support",value:fmt(sr.support),color:C.green,sub:"floor"},{label:"Resistance",value:fmt(sr.resistance),color:C.red,sub:"ceiling"},{label:"Bollinger",value:boll&&boll.upper?(L.closing_cbot>boll.upper?"Above":L.closing_cbot<boll.lower?"Below":"Inside"):"—",color:C.purple,sub:boll&&boll.upper?"U:"+fmt(boll.upper):""}].map(function(c,i){return(<div key={i} style={{background:C.card,border:"1px solid "+C.border,borderRadius:14,padding:"16px 18px"}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>{c.label}</div><div style={{fontSize:20,fontWeight:800,color:c.color}}>{c.value}</div><div style={{fontSize:11,color:C.sub}}>{c.sub}</div></div>);})}</div><div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,padding:"20px 24px"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}><div style={{fontSize:14,fontWeight:700,color:C.text}}>AI Market Analysis</div><button onClick={runAI} style={{padding:"7px 16px",borderRadius:10,border:"1px solid "+C.border,background:"transparent",color:C.sub,fontSize:11,cursor:"pointer",fontWeight:600}}>{aiLoad?"Analyzing...":"Refresh"}</button></div>{aiLoad?(<div style={{color:C.sub,fontSize:12,padding:"20px 0",textAlign:"center"}}>Scanning...</div>):ai?(<div style={{color:C.text,fontSize:12,lineHeight:1.9,whiteSpace:"pre-wrap",fontFamily:"monospace"}}>{ai}</div>):(<div style={{color:C.sub,fontSize:13,textAlign:"center",padding:"24px 0"}}>Click "Run AI Analysis" to generate a market report.</div>)}</div></div>)}
            {tab==="returns"&&(<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,padding:"20px 22px 14px"}}><div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:16}}>Daily Futures Returns (%)</div><ResponsiveContainer width="100%" height={300}><BarChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="date" tick={{fill:C.sub,fontSize:10}}/><YAxis tick={{fill:C.sub,fontSize:10}} tickFormatter={function(v){return v+"%";}}/><Tooltip content={<TT/>}/><ReferenceLine y={0} stroke={C.border} strokeWidth={2}/><Bar dataKey="ret" name="Return (%)" fill={C.blue} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>)}
            {tab==="weekly"&&(<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,overflow:"hidden"}}><div style={{padding:"18px 22px",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:14,fontWeight:700,color:C.text}}>Weekly Price Forecast</div><div style={{fontSize:11,color:C.sub}}>Next 5 trading days · Base ± 2% range</div></div><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr style={{background:C.bg}}>{["Date","CBOT Low","CBOT Base","CBOT High",isWheat?"11.5% (EGP)":"ARG (EGP)",isWheat?"12.5% (EGP)":"BRZ (EGP)"].map(function(h){return <th key={h} style={{padding:"12px 18px",textAlign:"left",color:C.sub,fontWeight:600,fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em"}}>{h}</th>;})}</tr></thead><tbody>{weekly.length===0?(<tr><td colSpan="6" style={{padding:"28px",textAlign:"center",color:C.sub}}>No forecast data</td></tr>):weekly.map(function(row,i){var base=Number(row.cbot_forecast);var low=(base*0.98).toFixed(2);var high=(base*1.02).toFixed(2);return(<tr key={i} style={{borderTop:"1px solid "+C.border,background:i===0?"rgba(79,142,247,0.05)":"transparent"}}><td style={{padding:"12px 18px",color:i===0?C.blue:C.text,fontWeight:i===0?700:500}}>{row.forecast_date}</td><td style={{padding:"12px 18px",color:C.red,fontWeight:600}}>{low}</td><td style={{padding:"12px 18px",color:C.blue,fontWeight:700}}>{base.toFixed(2)}</td><td style={{padding:"12px 18px",color:C.green,fontWeight:600}}>{high}</td><td style={{padding:"12px 18px",color:C.green,fontWeight:700}}>{row.arg_forecast?Math.round(row.arg_forecast).toLocaleString():"—"}</td><td style={{padding:"12px 18px",color:C.amber,fontWeight:700}}>{row.brz_forecast?Math.round(row.brz_forecast).toLocaleString():"—"}</td></tr>);})}</tbody></table></div>)}
            {tab==="news"&&(
              <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,overflow:"hidden"}}>
                <div style={{padding:"18px 22px",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:14,fontWeight:700,color:C.text}}>Market News</div>
                  <button onClick={loadNews} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.sub,fontSize:11,cursor:"pointer",fontWeight:600}}>{newsLoad?"Loading...":"Refresh"}</button>
                </div>
                {newsLoad?(
                  <div style={{padding:"24px",textAlign:"center",color:C.sub}}>Loading news...</div>
                ):news.length===0?(
                  <div style={{padding:"24px",textAlign:"center",color:C.sub}}>No news available</div>
                ):(
                  <div>
                    {news.map(function(item,i){
                      var date = new Date(item.pubDate).toLocaleDateString();
                      return(
                        <a key={i} href={item.link} target="_blank" rel="noreferrer" style={{display:"block",padding:"16px 22px",borderTop:i===0?"none":"1px solid "+C.border,textDecoration:"none",background:i%2===0?"transparent":C.bg+"80",transition:"background 0.2s"}}>
                          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4,lineHeight:1.4}}>{item.title}</div>
                          <div style={{display:"flex",gap:12,fontSize:11,color:C.sub}}>
                            <span>{item.source||"News"}</span>
                            <span>{date}</span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {tab==="table"&&(<div style={{background:C.card,border:"1px solid "+C.border,borderRadius:16,overflow:"hidden"}}><div style={{padding:"18px 22px",borderBottom:"1px solid "+C.border,fontSize:14,fontWeight:700,color:C.text}}>Raw Data — {data.length} records</div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{background:C.bg}}>{["Date","Close","Low","High","USD Rate",isWheat?"11.5%":"ARG",isWheat?"12.5%":"BRZ","Return"].map(function(h){return <th key={h} style={{padding:"11px 18px",textAlign:"left",color:C.sub,fontWeight:600,fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead><tbody>{data.map(function(row,i){var rc=row.fut_ret>0?C.green:row.fut_ret<0?C.red:C.sub;return(<tr key={i} style={{borderTop:"1px solid "+C.border,background:i===0?"rgba(79,142,247,0.05)":"transparent"}}><td style={{padding:"10px 18px",color:i===0?C.blue:C.sub,fontWeight:i===0?700:400}}>{row.date}</td><td style={{padding:"10px 18px",color:C.text,fontWeight:700}}>{fmt(row.closing_cbot)}</td><td style={{padding:"10px 18px",color:C.sub}}>{fmt(row.cbot_low)}</td><td style={{padding:"10px 18px",color:C.sub}}>{fmt(row.cbot_high)}</td><td style={{padding:"10px 18px",color:C.sub}}>{fmt(row.dollar_rate)}</td><td style={{padding:"10px 18px",color:C.green,fontWeight:600}}>{Math.round(row.arg_price).toLocaleString()}</td><td style={{padding:"10px 18px",color:C.amber,fontWeight:600}}>{Math.round(row.brz_price).toLocaleString()}</td><td style={{padding:"10px 18px",color:rc,fontWeight:600}}>{fmt(row.fut_ret*100,2)}%</td></tr>);})}</tbody></table></div></div>)}
          </div>
        )}
      </div>
    </div>
  );
} 
// force rebuild Sun Jun 21 00:09:55 UTC 2026
