import assert from 'node:assert/strict';
import {normalizePath,routedPath,segmentHitsBox} from './route_geometry.mjs';
import {inspectCustomLayout} from './layout_quality.mjs';

assert.deepEqual(normalizePath([[0,0],[0,10],[0,10],[0,20],[30,20]]),[[0,0],[0,20],[30,20]]);
assert.deepEqual(normalizePath([[0,0],[0,20],[0,10]]),[[0,0],[0,20],[0,10]]);
const a={x:20,y:20,width:160,height:80},b={x:20,y:220,width:160,height:80};
assert.deepEqual(routedPath(a,b,{fromSide:'bottom',toSide:'top',kind:'elbow'}),[[100,100],[100,220]]);
assert.throws(()=>routedPath(a,b,{fromSide:'right',toSide:'top',kind:'elbow'}),/显式路由点/);
assert.equal(segmentHitsBox([0,0],[100,100],{x:40,y:40,width:20,height:20}),true);
assert.equal(segmentHitsBox([0,0],[100,0],{x:40,y:40,width:20,height:20}),false);

const route={nodes:[{id:'a'},{id:'b'}],edges:[{id:'flow',from:'a',to:'b',certainty:'explicit',type:'sequence',label:'条件'}]};
const good={positions:{a,b},width:400,height:400,edgeWidth:2,routing:{flow:{fromSide:'bottom',toSide:'top',kind:'straight',label:{x:130,y:130,width:100,size:20}}}};
assert.deepEqual(inspectCustomLayout(route,good).warnings,[]);
const blocked=structuredClone(good);blocked.routing.flow.label.x=50;
assert.throws(()=>inspectCustomLayout(route,blocked),/连线被关系标签 flow 遮挡/);
const short=structuredClone(good);short.positions.b={x:188,y:20,width:160,height:80};
short.routing.flow={fromSide:'right',toSide:'left',kind:'straight',label:{x:150,y:130,width:100,size:20}};
assert.throws(()=>inspectCustomLayout(route,short),/箭头末段过短/);
console.log(JSON.stringify({passed:9,scope:'重合路由点、无效折线、标签遮线与短箭头末段'}));
