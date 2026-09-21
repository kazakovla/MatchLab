// node sync-data.cjs — обновляет статистику из GitHub и календарь источника.
// node sync-data.cjs --local — собирает страницу из уже скачанных CSV/JSON.
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, 'data/source');
const codes = ['E0', 'SP1', 'I1', 'D1', 'F1'];
const names = {E0:'Премьер-лига',SP1:'Ла Лига',I1:'Серия А',D1:'Бундеслига',F1:'Лига 1'};
function csv(text) {
  const rows = []; let row = [], cell = '', quote = false;
  for (let i=0;i<text.length;i++) { const c=text[i];
    if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}
    else if(c===','&&!quote){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  const header=rows.shift().map(s=>s.replace(/^\uFEFF/,'').trim());
  return rows.map(cells=>Object.fromEntries(header.map((key,i)=>[key,(cells[i]||'').trim()])));
}
function kickoff(date,time) {
  const parts=date.split('/').map(Number);if(parts.length!==3)throw Error('Invalid date '+date);
  const [day,month,y]=parts,year=y<100?2000+y:y;
  const [hour,minute]=(time||'12:00').split(':').map(Number);
  const wall=Date.UTC(year,month-1,day,hour,minute);
  // MatchLab matches.config.ts задаёт часовой пояс источника Europe/London.
  let instant=wall;
  for(let i=0;i<2;i++){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
    instant=wall-(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-instant);
  }
  return new Date(instant).toISOString();
}
async function main(){
 fs.mkdirSync(directory,{recursive:true});
 if(!process.argv.includes('--local')){
   const urls=[['corner_index.json','https://raw.githubusercontent.com/kazakovla/MatchLab/main/out/corner_index.json'],['corner_index.csv','https://raw.githubusercontent.com/kazakovla/MatchLab/main/out/corner_index.csv'],['fixtures.csv','https://www.football-data.co.uk/fixtures.csv']];
   for(const season of ['2425','2526'])for(const code of codes)urls.push([`${season}_${code}.csv`,`https://raw.githubusercontent.com/kazakovla/MatchLab/main/fd_cache/${season}_${code}.csv`]);
   // Сначала скачиваем весь набор; при ошибке текущая выгрузка остаётся рабочей.
   const downloaded=await Promise.all(urls.map(async([file,url])=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`${url}: ${response.status}`);return[file,await response.text()];}));
   for(const[file,text]of downloaded)fs.writeFileSync(path.join(directory,file),text);
 }
 const stats=JSON.parse(fs.readFileSync(path.join(directory,'corner_index.json'),'utf8'));
 const index=new Map(stats.rows.map(team=>[team.league_id+'|'+team.team,team]));
 const side=(code,name)=>{const stat=index.get(code+'|'+name);return{name,cornerIndex:stat?.enough_data?stat.ci:null,highlighted:!!stat?.enough_data&&stat.position<=6,stats:stat||null};};
 function convert(row,archive=false,season=''){
   const start=kickoff(row.Date,row.Time);
   const number=key=>row[key]!==''&&row[key]!==undefined&&Number.isFinite(Number(row[key]))?Number(row[key]):null;
   return{id:[row.Div,start,row.HomeTeam,row.AwayTeam].join('|'),kickoffAt:start,kickoffTimeKnown:!!row.Time,league:{code:row.Div,name:names[row.Div]},home:side(row.Div,row.HomeTeam),away:side(row.Div,row.AwayTeam),archive,season,score:archive&&number('FTHG')!==null&&number('FTAG')!==null?`${number('FTHG')}:${number('FTAG')}`:null,matchStats:archive?{homeCorners:number('HC'),awayCorners:number('AC'),homeShots:number('HS'),awayShots:number('AS'),homeShotsOnTarget:number('HST'),awayShotsOnTarget:number('AST')}:null};
 }
 const fixtures=csv(fs.readFileSync(path.join(directory,'fixtures.csv'),'utf8')).filter(row=>codes.includes(row.Div)&&row.Date&&row.HomeTeam&&row.AwayTeam).map(row=>convert(row));
 const history=[];
 for(const season of ['2425','2526'])for(const code of codes)for(const row of csv(fs.readFileSync(path.join(directory,`${season}_${code}.csv`),'utf8')))if(row.Date&&row.HomeTeam&&row.AwayTeam)history.push(convert(row,true,season==='2425'?'2024/25':'2025/26'));
 const data={downloadedAt:new Date().toISOString(),statisticsSource:'https://github.com/kazakovla/MatchLab',scheduleSource:'https://www.football-data.co.uk/fixtures.csv',sourceTimeZone:'Europe/London',teams:stats.rows,report:stats.report,fixtures,history};
 fs.writeFileSync(path.join(__dirname,'data/matchlab-data.js'),'window.MATCHLAB_DATA = '+JSON.stringify(data).replaceAll('<','\\u003c')+';\n');
 console.log(JSON.stringify({teams:stats.rows.length,fixtures:fixtures.length,history:history.length,first:fixtures.map(x=>x.kickoffAt).sort()[0],last:fixtures.map(x=>x.kickoffAt).sort().at(-1)}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
