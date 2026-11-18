import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=JSON.parse(await readFile(path.join(root,'playground/bandori/data/catalog.json'),'utf8'));
for(const name of ['playground/index.html','playground/bandori/index.html']){
 const p=path.join(root,name);let html=await readFile(p,'utf8');
 for(const key of ['count','animated'])html=html.replace(new RegExp(`(<!--lib:${key}-->)[\\s\\S]*?(<!--/lib:${key}-->)`,'g'),`$1${data[key]}$2`);
 await writeFile(p,html);
}
console.log(`Updated site labels: ${data.count} images, ${data.animated} animations, ${data.added} new.`);
