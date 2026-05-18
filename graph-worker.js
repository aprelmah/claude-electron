// graph-worker.js — corre la simulación d3-force fuera del main thread del renderer.
// Solo física. Sin DOM, sin SVG. El renderer mantiene los objetos y dibuja.
//
// Bundles d3 inlineados para sobrevivir al empaquetado en app.asar
// (las rutas a node_modules/* no son accesibles desde un Worker dentro del asar).
// Orden de inlineado: d3-dispatch, d3-timer, d3-quadtree, d3-force.
// Cada UMD cuelga sus exports en `self.d3 = self.d3 || {}`, así d3-force encuentra
// quadtree/dispatch/timer ya colgados antes de cargarse.
//
// Protocolo:
//   in:  { type: 'init', nodes: [{id, isRoot, fx, fy, radiusPad}], edges: [{source, target}], width, height, forces: {repulsion, linkDistance, compactness} }
//   in:  { type: 'setSize', width, height }
//   in:  { type: 'setForces', repulsion?, linkDistance?, compactness? }
//   in:  { type: 'setSpeed', factor }   // factor∈[0.1,1.0] -> velocityDecay∈[0.95,0.4]
//   in:  { type: 'pause' } | { type: 'resume', alpha=0.42 }
//   in:  { type: 'reheat', alpha=0.3 } | { type: 'reheatTarget', target=0.3 }
//   in:  { type: 'dragStart', id } | { type: 'drag', id, x, y } | { type: 'dragEnd', id, fixed }
//   in:  { type: 'replaceGraph', nodes, edges }  // rebuilds internal state
//   in:  { type: 'dispose' }
//
//   out: { type: 'tick', positions: Float32Array [x0,y0,x1,y1,...], ids: string[], alpha }   // ids enviado solo en 'init-ack' para mapeo
//   out: { type: 'init-ack', ids: string[] }
//   out: { type: 'end' }   // sim terminó (alpha < alphaMin)

// ============================================================================
// d3-dispatch v3.0.1 (Copyright 2010-2021 Mike Bostock, ISC license)
// ============================================================================
!function(n,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((n="undefined"!=typeof globalThis?globalThis:n||self).d3=n.d3||{})}(this,(function(n){"use strict";var e={value:()=>{}};function t(){for(var n,e=0,t=arguments.length,o={};e<t;++e){if(!(n=arguments[e]+"")||n in o||/[\s.]/.test(n))throw new Error("illegal type: "+n);o[n]=[]}return new r(o)}function r(n){this._=n}function o(n,e){return n.trim().split(/^|\s+/).map((function(n){var t="",r=n.indexOf(".");if(r>=0&&(t=n.slice(r+1),n=n.slice(0,r)),n&&!e.hasOwnProperty(n))throw new Error("unknown type: "+n);return{type:n,name:t}}))}function i(n,e){for(var t,r=0,o=n.length;r<o;++r)if((t=n[r]).name===e)return t.value}function f(n,t,r){for(var o=0,i=n.length;o<i;++o)if(n[o].name===t){n[o]=e,n=n.slice(0,o).concat(n.slice(o+1));break}return null!=r&&n.push({name:t,value:r}),n}r.prototype=t.prototype={constructor:r,on:function(n,e){var t,r=this._,l=o(n+"",r),a=-1,u=l.length;if(!(arguments.length<2)){if(null!=e&&"function"!=typeof e)throw new Error("invalid callback: "+e);for(;++a<u;)if(t=(n=l[a]).type)r[t]=f(r[t],n.name,e);else if(null==e)for(t in r)r[t]=f(r[t],n.name,null);return this}for(;++a<u;)if((t=(n=l[a]).type)&&(t=i(r[t],n.name)))return t},copy:function(){var n={},e=this._;for(var t in e)n[t]=e[t].slice();return new r(n)},call:function(n,e){if((t=arguments.length-2)>0)for(var t,r,o=new Array(t),i=0;i<t;++i)o[i]=arguments[i+2];if(!this._.hasOwnProperty(n))throw new Error("unknown type: "+n);for(i=0,t=(r=this._[n]).length;i<t;++i)r[i].value.apply(e,o)},apply:function(n,e,t){if(!this._.hasOwnProperty(n))throw new Error("unknown type: "+n);for(var r=this._[n],o=0,i=r.length;o<i;++o)r[o].value.apply(e,t)}},n.dispatch=t,Object.defineProperty(n,"__esModule",{value:!0})}));

// ============================================================================
// d3-timer v3.0.1 (Copyright 2010-2021 Mike Bostock, ISC license)
// En Worker: `typeof window === 'undefined'`, cae al fallback setTimeout(17ms).
// ============================================================================
!function(t,n){"object"==typeof exports&&"undefined"!=typeof module?n(exports):"function"==typeof define&&define.amd?define(["exports"],n):n((t="undefined"!=typeof globalThis?globalThis:t||self).d3=t.d3||{})}(this,(function(t){"use strict";var n,e,o=0,i=0,r=0,l=0,u=0,a=0,s="object"==typeof performance&&performance.now?performance:Date,c="object"==typeof window&&window.requestAnimationFrame?window.requestAnimationFrame.bind(window):function(t){setTimeout(t,17)};function f(){return u||(c(_),u=s.now()+a)}function _(){u=0}function m(){this._call=this._time=this._next=null}function p(t,n,e){var o=new m;return o.restart(t,n,e),o}function w(){f(),++o;for(var t,e=n;e;)(t=u-e._time)>=0&&e._call.call(void 0,t),e=e._next;--o}function d(){u=(l=s.now())+a,o=i=0;try{w()}finally{o=0,function(){var t,o,i=n,r=1/0;for(;i;)i._call?(r>i._time&&(r=i._time),t=i,i=i._next):(o=i._next,i._next=null,i=t?t._next=o:n=o);e=t,y(r)}(),u=0}}function h(){var t=s.now(),n=t-l;n>1e3&&(a-=n,l=t)}function y(t){o||(i&&(i=clearTimeout(i)),t-u>24?(t<1/0&&(i=setTimeout(d,t-s.now()-a)),r&&(r=clearInterval(r))):(r||(l=s.now(),r=setInterval(h,1e3)),o=1,c(d)))}m.prototype=p.prototype={constructor:m,restart:function(t,o,i){if("function"!=typeof t)throw new TypeError("callback is not a function");i=(null==i?f():+i)+(null==o?0:+o),this._next||e===this||(e?e._next=this:n=this,e=this),this._call=t,this._time=i,y()},stop:function(){this._call&&(this._call=null,this._time=1/0,y())}},t.interval=function(t,n,e){var o=new m,i=n;return null==n?(o.restart(t,n,e),o):(o._restart=o.restart,o.restart=function(t,n,e){n=+n,e=null==e?f():+e,o._restart((function r(l){l+=i,o._restart(r,i+=n,e),t(l)}),n,e)},o.restart(t,n,e),o)},t.now=f,t.timeout=function(t,n,e){var o=new m;return n=null==n?0:+n,o.restart((e=>{o.stop(),t(e+n)}),n,e),o},t.timer=p,t.timerFlush=w,Object.defineProperty(t,"__esModule",{value:!0})}));

// ============================================================================
// d3-quadtree v3.0.1 (Copyright 2010-2021 Mike Bostock, ISC license)
// ============================================================================
!function(t,i){"object"==typeof exports&&"undefined"!=typeof module?i(exports):"function"==typeof define&&define.amd?define(["exports"],i):i((t="undefined"!=typeof globalThis?globalThis:t||self).d3=t.d3||{})}(this,(function(t){"use strict";function i(t,i,e,n){if(isNaN(i)||isNaN(e))return t;var r,s,h,o,a,u,l,_,f,c=t._root,x={data:n},y=t._x0,d=t._y0,p=t._x1,v=t._y1;if(!c)return t._root=x,t;for(;c.length;)if((u=i>=(s=(y+p)/2))?y=s:p=s,(l=e>=(h=(d+v)/2))?d=h:v=h,r=c,!(c=c[_=l<<1|u]))return r[_]=x,t;if(o=+t._x.call(null,c.data),a=+t._y.call(null,c.data),i===o&&e===a)return x.next=c,r?r[_]=x:t._root=x,t;do{r=r?r[_]=new Array(4):t._root=new Array(4),(u=i>=(s=(y+p)/2))?y=s:p=s,(l=e>=(h=(d+v)/2))?d=h:v=h}while((_=l<<1|u)==(f=(a>=h)<<1|o>=s));return r[f]=c,r[_]=x,t}function e(t,i,e,n,r){this.node=t,this.x0=i,this.y0=e,this.x1=n,this.y1=r}function n(t){return t[0]}function r(t){return t[1]}function s(t,i,e){var s=new h(null==i?n:i,null==e?r:e,NaN,NaN,NaN,NaN);return null==t?s:s.addAll(t)}function h(t,i,e,n,r,s){this._x=t,this._y=i,this._x0=e,this._y0=n,this._x1=r,this._y1=s,this._root=void 0}function o(t){for(var i={data:t.data},e=i;t=t.next;)e=e.next={data:t.data};return i}var a=s.prototype=h.prototype;a.copy=function(){var t,i,e=new h(this._x,this._y,this._x0,this._y0,this._x1,this._y1),n=this._root;if(!n)return e;if(!n.length)return e._root=o(n),e;for(t=[{source:n,target:e._root=new Array(4)}];n=t.pop();)for(var r=0;r<4;++r)(i=n.source[r])&&(i.length?t.push({source:i,target:n.target[r]=new Array(4)}):n.target[r]=o(i));return e},a.add=function(t){const e=+this._x.call(null,t),n=+this._y.call(null,t);return i(this.cover(e,n),e,n,t)},a.addAll=function(t){var e,n,r,s,h=t.length,o=new Array(h),a=new Array(h),u=1/0,l=1/0,_=-1/0,f=-1/0;for(n=0;n<h;++n)isNaN(r=+this._x.call(null,e=t[n]))||isNaN(s=+this._y.call(null,e))||(o[n]=r,a[n]=s,r<u&&(u=r),r>_&&(_=r),s<l&&(l=s),s>f&&(f=s));if(u>_||l>f)return this;for(this.cover(u,l).cover(_,f),n=0;n<h;++n)i(this,o[n],a[n],t[n]);return this},a.cover=function(t,i){if(isNaN(t=+t)||isNaN(i=+i))return this;var e=this._x0,n=this._y0,r=this._x1,s=this._y1;if(isNaN(e))r=(e=Math.floor(t))+1,s=(n=Math.floor(i))+1;else{for(var h,o,a=r-e||1,u=this._root;e>t||t>=r||n>i||i>=s;)switch(o=(i<n)<<1|t<e,(h=new Array(4))[o]=u,u=h,a*=2,o){case 0:r=e+a,s=n+a;break;case 1:e=r-a,s=n+a;break;case 2:r=e+a,n=s-a;break;case 3:e=r-a,n=s-a}this._root&&this._root.length&&(this._root=u)}return this._x0=e,this._y0=n,this._x1=r,this._y1=s,this},a.data=function(){var t=[];return this.visit((function(i){if(!i.length)do{t.push(i.data)}while(i=i.next)})),t},a.extent=function(t){return arguments.length?this.cover(+t[0][0],+t[0][1]).cover(+t[1][0],+t[1][1]):isNaN(this._x0)?void 0:[[this._x0,this._y0],[this._x1,this._y1]]},a.find=function(t,i,n){var r,s,h,o,a,u,l,_=this._x0,f=this._y0,c=this._x1,x=this._y1,y=[],d=this._root;for(d&&y.push(new e(d,_,f,c,x)),null==n?n=1/0:(_=t-n,f=i-n,c=t+n,x=i+n,n*=n);u=y.pop();)if(!(!(d=u.node)||(s=u.x0)>c||(h=u.y0)>x||(o=u.x1)<_||(a=u.y1)<f))if(d.length){var p=(s+o)/2,v=(h+a)/2;y.push(new e(d[3],p,v,o,a),new e(d[2],s,v,p,a),new e(d[1],p,h,o,v),new e(d[0],s,h,p,v)),(l=(i>=v)<<1|t>=p)&&(u=y[y.length-1],y[y.length-1]=y[y.length-1-l],y[y.length-1-l]=u)}else{var w=t-+this._x.call(null,d.data),N=i-+this._y.call(null,d.data),g=w*w+N*N;if(g<n){var A=Math.sqrt(n=g);_=t-A,f=i-A,c=t+A,x=i+A,r=d.data}}return r},a.remove=function(t){if(isNaN(s=+this._x.call(null,t))||isNaN(h=+this._y.call(null,t)))return this;var i,e,n,r,s,h,o,a,u,l,_,f,c=this._root,x=this._x0,y=this._y0,d=this._x1,p=this._y1;if(!c)return this;if(c.length)for(;;){if((u=s>=(o=(x+d)/2))?x=o:d=o,(l=h>=(a=(y+p)/2))?y=a:p=a,i=c,!(c=c[_=l<<1|u]))return this;if(!c.length)break;(i[_+1&3]||i[_+2&3]||i[_+3&3])&&(e=i,f=_)}for(;c.data!==t;)if(n=c,!(c=c.next))return this;return(r=c.next)&&delete c.next,n?(r?n.next=r:delete n.next,this):i?(r?i[_]=r:delete i[_],(c=i[0]||i[1]||i[2]||i[3])&&c===(i[3]||i[2]||i[1]||i[0])&&!c.length&&(e?e[f]=c:this._root=c),this):(this._root=r,this)},a.removeAll=function(t){for(var i=0,e=t.length;i<e;++i)this.remove(t[i]);return this},a.root=function(){return this._root},a.size=function(){var t=0;return this.visit((function(i){if(!i.length)do{++t}while(i=i.next)})),t},a.visit=function(t){var i,n,r,s,h,o,a=[],u=this._root;for(u&&a.push(new e(u,this._x0,this._y0,this._x1,this._y1));i=a.pop();)if(!t(u=i.node,r=i.x0,s=i.y0,h=i.x1,o=i.y1)&&u.length){var l=(r+h)/2,_=(s+o)/2;(n=u[3])&&a.push(new e(n,l,_,h,o)),(n=u[2])&&a.push(new e(n,r,_,l,o)),(n=u[1])&&a.push(new e(n,l,s,h,_)),(n=u[0])&&a.push(new e(n,r,s,l,_))}return this},a.visitAfter=function(t){var i,n=[],r=[];for(this._root&&n.push(new e(this._root,this._x0,this._y0,this._x1,this._y1));i=n.pop();){var s=i.node;if(s.length){var h,o=i.x0,a=i.y0,u=i.x1,l=i.y1,_=(o+u)/2,f=(a+l)/2;(h=s[0])&&n.push(new e(h,o,a,_,f)),(h=s[1])&&n.push(new e(h,_,a,u,f)),(h=s[2])&&n.push(new e(h,o,f,_,l)),(h=s[3])&&n.push(new e(h,_,f,u,l))}r.push(i)}for(;i=r.pop();)t(i.node,i.x0,i.y0,i.x1,i.y1);return this},a.x=function(t){return arguments.length?(this._x=t,this):this._x},a.y=function(t){return arguments.length?(this._y=t,this):this._y},t.quadtree=s,Object.defineProperty(t,"__esModule",{value:!0})}));

// ============================================================================
// d3-force v3.0.0 (Copyright 2010-2021 Mike Bostock, ISC license)
// El UMD pasa el mismo objeto d3 como exports + 3 deps; quadtree/dispatch/timer
// ya están colgados de self.d3 por los inline previos.
// ============================================================================
!function(n,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports,require("d3-quadtree"),require("d3-dispatch"),require("d3-timer")):"function"==typeof define&&define.amd?define(["exports","d3-quadtree","d3-dispatch","d3-timer"],t):t((n="undefined"!=typeof globalThis?globalThis:n||self).d3=n.d3||{},n.d3,n.d3,n.d3)}(this,(function(n,t,e,r){"use strict";function i(n){return function(){return n}}function u(n){return 1e-6*(n()-.5)}function o(n){return n.x+n.vx}function f(n){return n.y+n.vy}function a(n){return n.index}function c(n,t){var e=n.get(t);if(!e)throw new Error("node not found: "+t);return e}const l=4294967296;function h(n){return n.x}function v(n){return n.y}var y=Math.PI*(3-Math.sqrt(5));n.forceCenter=function(n,t){var e,r=1;function i(){var i,u,o=e.length,f=0,a=0;for(i=0;i<o;++i)f+=(u=e[i]).x,a+=u.y;for(f=(f/o-n)*r,a=(a/o-t)*r,i=0;i<o;++i)(u=e[i]).x-=f,u.y-=a}return null==n&&(n=0),null==t&&(t=0),i.initialize=function(n){e=n},i.x=function(t){return arguments.length?(n=+t,i):n},i.y=function(n){return arguments.length?(t=+n,i):t},i.strength=function(n){return arguments.length?(r=+n,i):r},i},n.forceCollide=function(n){var e,r,a,c=1,l=1;function h(){for(var n,i,h,y,d,g,x,s=e.length,p=0;p<l;++p)for(i=t.quadtree(e,o,f).visitAfter(v),n=0;n<s;++n)h=e[n],g=r[h.index],x=g*g,y=h.x+h.vx,d=h.y+h.vy,i.visit(M);function M(n,t,e,r,i){var o=n.data,f=n.r,l=g+f;if(!o)return t>y+l||r<y-l||e>d+l||i<d-l;if(o.index>h.index){var v=y-o.x-o.vx,s=d-o.y-o.vy,p=v*v+s*s;p<l*l&&(0===v&&(p+=(v=u(a))*v),0===s&&(p+=(s=u(a))*s),p=(l-(p=Math.sqrt(p)))/p*c,h.vx+=(v*=p)*(l=(f*=f)/(x+f)),h.vy+=(s*=p)*l,o.vx-=v*(l=1-l),o.vy-=s*l)}}}function v(n){if(n.data)return n.r=r[n.data.index];for(var t=n.r=0;t<4;++t)n[t]&&n[t].r>n.r&&(n.r=n[t].r)}function y(){if(e){var t,i,u=e.length;for(r=new Array(u),t=0;t<u;++t)i=e[t],r[i.index]=+n(i,t,e)}}return"function"!=typeof n&&(n=i(null==n?1:+n)),h.initialize=function(n,t){e=n,a=t,y()},h.iterations=function(n){return arguments.length?(l=+n,h):l},h.strength=function(n){return arguments.length?(c=+n,h):c},h.radius=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),y(),h):n},h},n.forceLink=function(n){var t,e,r,o,f,l,h=a,v=function(n){return 1/Math.min(o[n.source.index],o[n.target.index])},y=i(30),d=1;function g(r){for(var i=0,o=n.length;i<d;++i)for(var a,c,h,v,y,g,x,s=0;s<o;++s)c=(a=n[s]).source,v=(h=a.target).x+h.vx-c.x-c.vx||u(l),y=h.y+h.vy-c.y-c.vy||u(l),v*=g=((g=Math.sqrt(v*v+y*y))-e[s])/g*r*t[s],y*=g,h.vx-=v*(x=f[s]),h.vy-=y*x,c.vx+=v*(x=1-x),c.vy+=y*x}function x(){if(r){var i,u,a=r.length,l=n.length,v=new Map(r.map(((n,t)=>[h(n,t,r),n])));for(i=0,o=new Array(a);i<l;++i)(u=n[i]).index=i,"object"!=typeof u.source&&(u.source=c(v,u.source)),"object"!=typeof u.target&&(u.target=c(v,u.target)),o[u.source.index]=(o[u.source.index]||0)+1,o[u.target.index]=(o[u.target.index]||0)+1;for(i=0,f=new Array(l);i<l;++i)u=n[i],f[i]=o[u.source.index]/(o[u.source.index]+o[u.target.index]);t=new Array(l),s(),e=new Array(l),p()}}function s(){if(r)for(var e=0,i=n.length;e<i;++e)t[e]=+v(n[e],e,n)}function p(){if(r)for(var t=0,i=n.length;t<i;++t)e[t]=+y(n[t],t,n)}return null==n&&(n=[]),g.initialize=function(n,t){r=n,l=t,x()},g.links=function(t){return arguments.length?(n=t,x(),g):n},g.id=function(n){return arguments.length?(h=n,g):h},g.iterations=function(n){return arguments.length?(d=+n,g):d},g.strength=function(n){return arguments.length?(v="function"==typeof n?n:i(+n),s(),g):v},g.distance=function(n){return arguments.length?(y="function"==typeof n?n:i(+n),p(),g):y},g},n.forceManyBody=function(){var n,e,r,o,f,a=i(-30),c=1,l=1/0,y=.81;function d(r){var i,u=n.length,f=t.quadtree(n,h,v).visitAfter(x);for(o=r,i=0;i<u;++i)e=n[i],f.visit(s)}function g(){if(n){var t,e,r=n.length;for(f=new Array(r),t=0;t<r;++t)e=n[t],f[e.index]=+a(e,t,n)}}function x(n){var t,e,r,i,u,o=0,a=0;if(n.length){for(r=i=u=0;u<4;++u)(t=n[u])&&(e=Math.abs(t.value))&&(o+=t.value,a+=e,r+=e*t.x,i+=e*t.y);n.x=r/a,n.y=i/a}else{(t=n).x=t.data.x,t.y=t.data.y;do{o+=f[t.data.index]}while(t=t.next)}n.value=o}function s(n,t,i,a){if(!n.value)return!0;var h=n.x-e.x,v=n.y-e.y,d=a-t,g=h*h+v*v;if(d*d/y<g)return g<l&&(0===h&&(g+=(h=u(r))*h),0===v&&(g+=(v=u(r))*v),g<c&&(g=Math.sqrt(c*g)),e.vx+=h*n.value*o/g,e.vy+=v*n.value*o/g),!0;if(!(n.length||g>=l)){(n.data!==e||n.next)&&(0===h&&(g+=(h=u(r))*h),0===v&&(g+=(v=u(r))*v),g<c&&(g=Math.sqrt(c*g)));do{n.data!==e&&(d=f[n.data.index]*o/g,e.vx+=h*d,e.vy+=v*d)}while(n=n.next)}}return d.initialize=function(t,e){n=t,r=e,g()},d.strength=function(n){return arguments.length?(a="function"==typeof n?n:i(+n),g(),d):a},d.distanceMin=function(n){return arguments.length?(c=n*n,d):Math.sqrt(c)},d.distanceMax=function(n){return arguments.length?(l=n*n,d):Math.sqrt(l)},d.theta=function(n){return arguments.length?(y=n*n,d):Math.sqrt(y)},d},n.forceRadial=function(n,t,e){var r,u,o,f=i(.1);function a(n){for(var i=0,f=r.length;i<f;++i){var a=r[i],c=a.x-t||1e-6,l=a.y-e||1e-6,h=Math.sqrt(c*c+l*l),v=(o[i]-h)*u[i]*n/h;a.vx+=c*v,a.vy+=l*v}}function c(){if(r){var t,e=r.length;for(u=new Array(e),o=new Array(e),t=0;t<e;++t)o[t]=+n(r[t],t,r),u[t]=isNaN(o[t])?0:+f(r[t],t,r)}}return"function"!=typeof n&&(n=i(+n)),null==t&&(t=0),null==e&&(e=0),a.initialize=function(n){r=n,c()},a.strength=function(n){return arguments.length?(f="function"==typeof n?n:i(+n),c(),a):f},a.radius=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),c(),a):n},a.x=function(n){return arguments.length?(t=+n,a):t},a.y=function(n){return arguments.length?(e=+n,a):e},a},n.forceSimulation=function(n){var t,i=1,u=.001,o=1-Math.pow(u,1/300),f=0,a=.6,c=new Map,h=r.timer(g),v=e.dispatch("tick","end"),d=function(){let n=1;return()=>(n=(1664525*n+1013904223)%l)/l}();function g(){x(),v.call("tick",t),i<u&&(h.stop(),v.call("end",t))}function x(e){var r,u,l=n.length;void 0===e&&(e=1);for(var h=0;h<e;++h)for(i+=(f-i)*o,c.forEach((function(n){n(i)})),r=0;r<l;++r)null==(u=n[r]).fx?u.x+=u.vx*=a:(u.x=u.fx,u.vx=0),null==u.fy?u.y+=u.vy*=a:(u.y=u.fy,u.vy=0);return t}function s(){for(var t,e=0,r=n.length;e<r;++e){if((t=n[e]).index=e,null!=t.fx&&(t.x=t.fx),null!=t.fy&&(t.y=t.fy),isNaN(t.x)||isNaN(t.y)){var i=10*Math.sqrt(.5+e),u=e*y;t.x=i*Math.cos(u),t.y=i*Math.sin(u)}(isNaN(t.vx)||isNaN(t.vy))&&(t.vx=t.vy=0)}}function p(t){return t.initialize&&t.initialize(n,d),t}return null==n&&(n=[]),s(),t={tick:x,restart:function(){return h.restart(g),t},stop:function(){return h.stop(),t},nodes:function(e){return arguments.length?(n=e,s(),c.forEach(p),t):n},alpha:function(n){return arguments.length?(i=+n,t):i},alphaMin:function(n){return arguments.length?(u=+n,t):u},alphaDecay:function(n){return arguments.length?(o=+n,t):+o},alphaTarget:function(n){return arguments.length?(f=+n,t):f},velocityDecay:function(n){return arguments.length?(a=1-n,t):1-a},randomSource:function(n){return arguments.length?(d=n,c.forEach(p),t):d},force:function(n,e){return arguments.length>1?(null==e?c.delete(n):c.set(n,p(e)),t):c.get(n)},find:function(t,e,r){var i,u,o,f,a,c=0,l=n.length;for(null==r?r=1/0:r*=r,c=0;c<l;++c)(o=(i=t-(f=n[c]).x)*i+(u=e-f.y)*u)<r&&(a=f,r=o);return a},on:function(n,e){return arguments.length>1?(v.on(n,e),t):v.on(n)}}},n.forceX=function(n){var t,e,r,u=i(.1);function o(n){for(var i,u=0,o=t.length;u<o;++u)(i=t[u]).vx+=(r[u]-i.x)*e[u]*n}function f(){if(t){var i,o=t.length;for(e=new Array(o),r=new Array(o),i=0;i<o;++i)e[i]=isNaN(r[i]=+n(t[i],i,t))?0:+u(t[i],i,t)}}return"function"!=typeof n&&(n=i(null==n?0:+n)),o.initialize=function(n){t=n,f()},o.strength=function(n){return arguments.length?(u="function"==typeof n?n:i(+n),f(),o):u},o.x=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),f(),o):n},o},n.forceY=function(n){var t,e,r,u=i(.1);function o(n){for(var i,u=0,o=t.length;u<o;++u)(i=t[u]).vy+=(r[u]-i.y)*e[u]*n}function f(){if(t){var i,o=t.length;for(e=new Array(o),r=new Array(o),i=0;i<o;++i)e[i]=isNaN(r[i]=+n(t[i],i,t))?0:+u(t[i],i,t)}}return"function"!=typeof n&&(n=i(null==n?0:+n)),o.initialize=function(n){t=n,f()},o.strength=function(n){return arguments.length?(u="function"==typeof n?n:i(+n),f(),o):u},o.y=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),f(),o):n},o},Object.defineProperty(n,"__esModule",{value:!0})}));

// ============================================================================
// Worker logic
// ============================================================================

const d3 = self.d3

let sim = null
let nodes = []           // copia local de la sim
let simEdges = []        // copia local con refs a nodos
let nodeById = new Map() // id -> nodo local
let ids = []             // orden estable para la Float32Array
// Pool de 2 buffers Float32Array alternados. Cada tick transferimos uno (zero-copy)
// y rellenamos el otro en el siguiente tick. Evita alloc por tick y GC pressure.
let bufA = null
let bufB = null
let bufActive = 0        // 0 -> usar bufA en el próximo emitTick, 1 -> bufB
let paused = false
let disposed = false
let width = 800
let height = 600
let forces = { repulsion: -220, linkDistance: 80, compactness: 0.06 }
// Velocidad de la simulación. factor ∈ [0.1,1.0] (1.0 = rápido por defecto d3).
// Mapeo: velocityDecay = 0.4 + (1 - factor) * 0.55 → factor=1→0.4 / factor=0.1→0.95.
// alphaDecay también se ajusta sutilmente para que el reheat dure proporcional sin trabar.
let speedFactor = 1.0
function speedToVelocityDecay (f) { return 0.4 + (1 - f) * 0.55 }
function speedToAlphaDecay (f) {
  // d3 default ≈ 0.0228 (1 - 0.001^(1/300)). Bajamos hasta ~0.0114 cuando f=0.1
  // para que el grafo no se "muera" en seco al ir lento.
  return 0.0228 - (1 - f) * 0.0114
}
function applySpeedToSim () {
  if (!sim) return
  sim.velocityDecay(speedToVelocityDecay(speedFactor))
  sim.alphaDecay(speedToAlphaDecay(speedFactor))
}
// F-hier: parámetros de jerarquía. Distancia/fuerza de aristas según kind.
//   parent-child → más corto y rígido (estructura visible).
//   reference    → más largo y flexible (referencias entre archivos).
const HIER = {
  pcDistance: 35,
  refDistance: 90,
  pcStrength: 0.9,
  refStrength: 0.3,
  clusterStrength: 0.18 // intensidad de la fuerza cluster (multiplicada por alpha)
}
// Centroides por parentId, recalculados cada tick antes de aplicar la fuerza.
const clusterCentroid = new Map()

function ensureBuffers (len) {
  const bytes = len * 2
  if (!bufA || bufA.length !== bytes || bufA.buffer.byteLength === 0) bufA = new Float32Array(bytes)
  if (!bufB || bufB.length !== bytes || bufB.buffer.byteLength === 0) bufB = new Float32Array(bytes)
}

function linkDistanceFor (e) {
  // F-hier: parent-child más corto; reference (o sin kind) más largo.
  // Si el usuario tunea linkDistance desde UI, lo respetamos como base para refs.
  if (e && e.kind === 'parent-child') return HIER.pcDistance
  return forces.linkDistance
}
function linkStrengthFor (e) {
  if (e && e.kind === 'parent-child') return HIER.pcStrength
  return HIER.refStrength
}

// F-hier: fuerza cluster. Atrae cada nodo (con parentId) hacia el centroide de
// sus hermanos (nodos con el mismo parentId). El centroide se recalcula al
// inicio de cada llamada (un tick = una llamada). Coste O(n) por tick.
// Limitación conocida: en grafos enormes (>5k nodos) puede notarse leve coste;
// d3-quadtree no se usa aquí porque la agrupación es por id, no por proximidad.
function forceCluster (alpha) {
  if (!nodes.length) return
  clusterCentroid.clear()
  // Acumular sumas por parentId.
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const pid = n.__parentId
    if (!pid) continue
    let c = clusterCentroid.get(pid)
    if (!c) { c = { x: 0, y: 0, n: 0 }; clusterCentroid.set(pid, c) }
    c.x += n.x
    c.y += n.y
    c.n += 1
  }
  // Promediar.
  clusterCentroid.forEach(c => { if (c.n) { c.x /= c.n; c.y /= c.n } })
  // Aplicar velocidad hacia centroide. k = clusterStrength * alpha.
  const k = HIER.clusterStrength * alpha
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const pid = n.__parentId
    if (!pid) continue
    const c = clusterCentroid.get(pid)
    if (!c || c.n < 2) continue // hijo único: no cluster (evita ruido)
    n.vx += (c.x - n.x) * k
    n.vy += (c.y - n.y) * k
  }
}

function buildSim () {
  if (sim) { sim.stop(); sim = null }
  sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(simEdges).id(d => d.id)
      .distance(linkDistanceFor)
      .strength(linkStrengthFor))
    .force('charge', d3.forceManyBody().strength(forces.repulsion))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('x', d3.forceX(width / 2).strength(forces.compactness))
    .force('y', d3.forceY(height / 2).strength(forces.compactness))
    .force('collide', d3.forceCollide().radius(d => (d.__pad || 12) + 10))
    .force('cluster', forceCluster)
    .on('tick', emitTick)
    .on('end', () => { if (!disposed) self.postMessage({ type: 'end' }) })
  // Reaplicar velocidad tras cada (re)build de la simulación.
  applySpeedToSim()
  if (paused) sim.stop()
}

function emitTick () {
  if (disposed) return
  // El buffer destinatario puede haber sido transferido en el tick anterior;
  // ensureBuffers reasigna si está detached (byteLength === 0).
  ensureBuffers(nodes.length)
  const out = bufActive === 0 ? bufA : bufB
  for (let i = 0; i < nodes.length; i++) {
    out[i * 2] = nodes[i].x ?? 0
    out[i * 2 + 1] = nodes[i].y ?? 0
  }
  bufActive = bufActive === 0 ? 1 : 0
  // Transfer: zero-copy hacia el main thread. Tras esto, out.buffer queda detached
  // en el worker; ensureBuffers lo recreará en el siguiente tick si toca.
  try {
    self.postMessage({ type: 'tick', positions: out, alpha: sim.alpha() }, [out.buffer])
  } catch (_) {
    // Si transfer falla (raro), fallback copia.
    self.postMessage({ type: 'tick', positions: new Float32Array(out), alpha: sim.alpha() })
  }
}

self.onmessage = (ev) => {
  if (disposed) return
  const msg = ev.data || {}
  switch (msg.type) {
    case 'init':
    case 'replaceGraph': {
      width = msg.width || width
      height = msg.height || height
      if (msg.forces) forces = { ...forces, ...msg.forces }
      if (typeof msg.speedFactor === 'number') {
        speedFactor = Math.max(0.1, Math.min(1, msg.speedFactor))
      }
      // Construir nodos locales (clonados, no refs a originales del main)
      nodes = (msg.nodes || []).map(n => {
        const o = {
          id: n.id,
          x: n.x ?? (width / 2 + (Math.random() - 0.5) * 40),
          y: n.y ?? (height / 2 + (Math.random() - 0.5) * 40),
          vx: 0,
          vy: 0,
          __pad: n.radiusPad || 12,
          // F-hier: metadata jerárquica para forceCluster.
          __parentId: n.parentId || null
        }
        if (n.fx != null) o.fx = n.fx
        if (n.fy != null) o.fy = n.fy
        if (n.isRoot) { o.fx = width / 2; o.fy = height / 2 }
        return o
      })
      nodeById = new Map(nodes.map(n => [n.id, n]))
      simEdges = (msg.edges || []).map(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source
        const t = typeof e.target === 'object' ? e.target.id : e.target
        // F-hier: preservar kind para callbacks de distance/strength.
        return { source: nodeById.get(s) || s, target: nodeById.get(t) || t, kind: e.kind || 'reference' }
      })
      ids = nodes.map(n => n.id)
      // Resetear pool: tamaño puede haber cambiado.
      bufA = null
      bufB = null
      bufActive = 0
      ensureBuffers(nodes.length)
      self.postMessage({ type: 'init-ack', ids })
      buildSim()
      if (!paused) sim.alpha(msg.alpha ?? 0.6).restart()
      break
    }
    case 'setSize': {
      width = msg.width || width
      height = msg.height || height
      if (!sim) break
      sim.force('center', d3.forceCenter(width / 2, height / 2))
      sim.force('x', d3.forceX(width / 2).strength(forces.compactness))
      sim.force('y', d3.forceY(height / 2).strength(forces.compactness))
      if (!paused) sim.alpha(0.3).restart()
      break
    }
    case 'setRootFixed': {
      const n = nodeById.get(msg.id)
      if (n) { n.fx = width / 2; n.fy = height / 2 }
      if (!paused && sim) sim.alpha(0.3).restart()
      break
    }
    case 'setForces': {
      if (msg.repulsion !== undefined) {
        forces.repulsion = msg.repulsion
        if (sim) sim.force('charge', d3.forceManyBody().strength(forces.repulsion))
      }
      if (msg.linkDistance !== undefined) {
        forces.linkDistance = msg.linkDistance
        // F-hier: rebuild link force preservando callbacks por kind.
        if (sim) sim.force('link', d3.forceLink(simEdges).id(n => n.id)
          .distance(linkDistanceFor)
          .strength(linkStrengthFor))
      }
      if (msg.compactness !== undefined) {
        forces.compactness = msg.compactness
        if (sim) {
          sim.force('x', d3.forceX(width / 2).strength(forces.compactness))
          sim.force('y', d3.forceY(height / 2).strength(forces.compactness))
        }
      }
      if (!paused && sim) sim.alpha(0.4).restart()
      break
    }
    case 'setSpeed': {
      if (typeof msg.factor === 'number') {
        speedFactor = Math.max(0.1, Math.min(1, msg.factor))
        applySpeedToSim()
      }
      break
    }
    case 'pause': {
      paused = true
      if (sim) sim.stop()
      break
    }
    case 'resume': {
      paused = false
      if (sim) sim.alpha(msg.alpha ?? 0.42).restart()
      break
    }
    case 'reheat': {
      if (!paused && sim) sim.alpha(msg.alpha ?? 0.3).restart()
      break
    }
    case 'alphaTarget': {
      if (sim) sim.alphaTarget(msg.target ?? 0)
      if (msg.restart && !paused && sim) sim.restart()
      break
    }
    case 'dragStart': {
      const n = nodeById.get(msg.id)
      if (!n) break
      n.fx = n.x
      n.fy = n.y
      if (!paused && sim) { sim.alphaTarget(0.3).restart() }
      break
    }
    case 'drag': {
      const n = nodeById.get(msg.id)
      if (!n) break
      n.fx = msg.x
      n.fy = msg.y
      break
    }
    case 'dragEnd': {
      const n = nodeById.get(msg.id)
      if (!n) break
      // Liberar fx/fy salvo que el caller pida keepFixed (root). Sin esto el nodo
      // quedaría pegado tras soltar.
      if (!msg.keepFixed) { n.fx = null; n.fy = null }
      if (sim) sim.alphaTarget(0)
      break
    }
    case 'dispose': {
      disposed = true
      if (sim) { sim.stop(); sim = null }
      nodes = []
      simEdges = []
      nodeById.clear()
      ids = []
      bufA = null
      bufB = null
      // Quitar handler antes de cerrar: defensa frente a mensajes en cola.
      self.onmessage = null
      self.close()
      break
    }
    default:
      // ignore
      break
  }
}
