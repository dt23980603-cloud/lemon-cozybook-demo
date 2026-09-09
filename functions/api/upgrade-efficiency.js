const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store'
};

async function ensureTable(db){
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS upgrade_efficiency_config (
      id INTEGER PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

function validateData(data){
  if(!data||typeof data!=='object')return false;
  if(!Array.isArray(data.levels)||data.levels.length!==3)return false;
  if(!data.grades||typeof data.grades!=='object')return false;
  if(!Array.isArray(data.sections)||data.sections.length<1||data.sections.length>20)return false;
  for(const section of data.sections){
    if(!section||typeof section!=='object'||typeof section.title!=='string'||!Array.isArray(section.rows))return false;
    if(section.title.length>100||String(section.note||'').length>1000||section.rows.length>10)return false;
    for(const row of section.rows){
      if(!row||typeof row.grade!=='string'||!Array.isArray(row.values)||row.values.length!==3)return false;
      if(row.grade.length>30||row.values.some(v=>String(v??'').length>100))return false;
    }
  }
  return true;
}

export async function onRequestGet(context){
  const {env}=context;
  if(!env.DB)return new Response(JSON.stringify({error:'D1 binding DB is not configured.'}),{status:500,headers:JSON_HEADERS});
  await ensureTable(env.DB);
  const row=await env.DB.prepare(`SELECT data_json,updated_at FROM upgrade_efficiency_config WHERE id=1`).first();
  if(!row)return new Response(JSON.stringify({exists:false,data:null}),{headers:JSON_HEADERS});
  try{
    return new Response(JSON.stringify({exists:true,data:JSON.parse(row.data_json),updatedAt:Number(row.updated_at||0)}),{headers:JSON_HEADERS});
  }catch(_){
    return new Response(JSON.stringify({exists:false,data:null}),{headers:JSON_HEADERS});
  }
}

export async function onRequestPut(context){
  const {env,request}=context;
  if(!env.DB)return new Response(JSON.stringify({error:'D1 binding DB is not configured.'}),{status:500,headers:JSON_HEADERS});
  let body;
  try{body=await request.json()}catch(_){
    return new Response(JSON.stringify({error:'Invalid JSON body.'}),{status:400,headers:JSON_HEADERS});
  }
  const data=body?.data;
  if(!validateData(data)){
    return new Response(JSON.stringify({error:'Invalid efficiency data.'}),{status:400,headers:JSON_HEADERS});
  }
  const json=JSON.stringify(data);
  if(json.length>50000){
    return new Response(JSON.stringify({error:'Efficiency data is too large.'}),{status:413,headers:JSON_HEADERS});
  }
  await ensureTable(env.DB);
  const now=Date.now();
  await env.DB.prepare(`
    INSERT INTO upgrade_efficiency_config (id,data_json,updated_at)
    VALUES (1,?1,?2)
    ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at
  `).bind(json,now).run();
  return new Response(JSON.stringify({ok:true,updatedAt:now}),{headers:JSON_HEADERS});
}
