(this.webpackJsonpdebrief=this.webpackJsonpdebrief||[]).push([[0],{204:function(e,t,c){},205:function(e,t,c){},206:function(e,t,c){"use strict";c.r(t);var n,i=c(3),r=c(0),s=c.n(r),a=c(74),o=c.n(a),l=(c(86),c(47)),u=c.n(l),d=c(75),j=c(5),b=c(13),f=c(16),h=c(80),m=(c(203),c.p+"static/media/interchange.d1c1fd49.png"),g=(c(204),c(205),c.p+"static/media/select.a36d8019.svg"),O=c.p+"static/media/pencil.6f256236.svg",p=c.p+"static/media/eraser.fa7a8623.svg",v=c.p+"static/media/undo.ccba6760.svg",x=c.p+"static/media/marker.79266f62.svg",C=c.p+"static/media/save.d3fc937a.svg",k=c.p+"static/media/pmc-thick.e9f45228.svg",w=c.p+"static/media/pmc-med.c746c927.svg",y=c.p+"static/media/pmc-light.62ae8236.svg",D=c.p+"static/media/scav.638c46be.svg",M={width:300,height:300},P=new Set;var N={},S="#f00";function L(e){var t=e.title,c=e.children;return Object(i.jsxs)("div",{className:"sidebar-section",children:[Object(i.jsx)("h1",{className:"sidebar-section-title",children:t}),Object(i.jsx)("div",{className:"sidebar-section-content",children:c})]})}var B=function(){var e=Object(r.useRef)(null),t=Object(r.useState)({type:"pencil",active:!0,onClick:null,cursor:null}),c=Object(b.a)(t,2),s=c[0],a=c[1],o=Object(r.useRef)({type:"pencil",active:!0,onClick:null,cursor:null}),l=Object(r.useState)(S),B=Object(b.a)(l,2),E=B[0],R=B[1],A=Object(r.useState)(null),F=Object(b.a)(A,2)[1],I=Object(r.useRef)(null),T=Object(r.useState)(null),z=Object(b.a)(T,2),U=z[0],H=z[1],J=Object(r.useState)(!1),Y=Object(b.a)(J,2),Z=Y[0],K=Y[1],W=function(e){U&&(s.onClick&&U.off("mouse:up",s.onClick),e.onClick&&U.on("mouse:up",e.onClick),null===e.cursor?(U.defaultCursor="auto",U.hoverCursor="auto"):(U.defaultCursor=e.cursor,U.hoverCursor=U.defaultCursor),"pencil"===e.type?U.isDrawingMode=!0:U.isDrawingMode=!1),K(!1),a(e),o.current=e},X=function(e){var t,c=e.target;t=c.src,F(t),I.current=t;var n="url(".concat(c.src,"), auto");W(Object(j.a)(Object(j.a)({},s),{},{type:"marker",onClick:q,cursor:n}))},q=function(){var e=Object(d.a)(u.a.mark((function e(t){var c,n,i,r,s;return u.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:if(!I||!I.current){e.next=17;break}if(c=N[I.current]){e.next=8;break}return e.next=5,new Promise((function(e){return f.fabric.Image.fromURL(I.current,e)}));case 5:n=e.sent,N[I.current]=n,c=n;case 8:return e.next=10,new Promise((function(e){return c.clone(e)}));case 10:i=e.sent,r=U.getPointer(t.e),i.left=r.x,i.top=r.y,s=U.getZoom(),i.scale(1/s),U.add(i);case 17:case"end":return e.stop()}}),e)})));return function(t){return e.apply(this,arguments)}}();return Object(r.useEffect)((function(){if(!U){var t=function(){var e=new f.fabric.Canvas("canvas",{height:M.height,width:M.width,perPixelTargetFind:!0,selection:!1});return e.freeDrawingBrush.color=S,e.freeDrawingBrush.width=5,e.setCursor("url(".concat(O,")")),e}();H(t),f.fabric.Image.fromURL(m,(function(e){e.canvas=t,e.selectable=!1,n=e,P.add(n.getSrc()),t.add(e),t.clearHistory()})),t.on("mouse:down",(function(e){W(Object(j.a)(Object(j.a)({},o.current),{},{active:!0}))})),t.on("mouse:up",(function(e){W(Object(j.a)(Object(j.a)({},o.current),{},{active:!1}))})),t.on("mouse:move",(function(e){null!==e.target&&(e.target instanceof f.fabric.Image&&P.has(e.target.getSrc())||"eraser"===o.current.type&&o.current.active&&t.remove(e.target))})),t.on("mouse:wheel",(function(e){var c=e.e,n=c.deltaY,i=t.getZoom();(i*=Math.pow(.999,n))>20&&(i=20),i<.01&&(i=.01),t.zoomToPoint({x:c.offsetX,y:c.offsetY},i),t.freeDrawingBrush.width=5/i,e.e.preventDefault(),e.e.stopPropagation()}))}function c(){if(e.current){var t=e.current.offsetWidth,c=e.current.offsetHeight;null===U||void 0===U||U.setDimensions({width:t,height:c})}else null===U||void 0===U||U.setDimensions(M)}return c(),window.addEventListener("resize",c),document.addEventListener("keyup",(function(e){var t=e.key;e.ctrlKey&&"z"===t&&U&&U.undo()})),function(){window.removeEventListener("resize",c)}}),[e,U]),Object(i.jsxs)("div",{className:"App",children:[Object(i.jsxs)("header",{className:"App-header",children:[Object(i.jsx)("p",{className:"title",children:"Tarkov Debrief"}),Object(i.jsxs)("section",{className:"App-header-buttons",children:[Object(i.jsx)("button",{onClick:function(){W(Object(j.a)(Object(j.a)({},s),{},{type:"select",cursor:null,onClick:null})),U&&(U.isDrawingMode=!1,U.selection=!0)},children:Object(i.jsx)("img",{src:g,alt:"select"})}),Object(i.jsx)("button",{onClick:function(){W(Object(j.a)(Object(j.a)({},s),{},{type:"pencil",cursor:null,onClick:null})),U&&(U.isDrawingMode=!0)},children:Object(i.jsx)("img",{src:O,alt:"pencil"})}),Object(i.jsx)("button",{onClick:function(){W(Object(j.a)(Object(j.a)({},s),{},{type:"eraser",cursor:null,onClick:null})),U&&(U.isDrawingMode=!1,U.selection=!1)},children:Object(i.jsx)("img",{src:p,alt:"eraser"})}),Object(i.jsx)("button",{onClick:function(){U&&U.undo()},children:Object(i.jsx)("img",{src:v,alt:"undo"})}),Object(i.jsx)("button",{onClick:function(){K(!0)},children:Object(i.jsx)("img",{src:x,alt:"undo"})}),Object(i.jsx)("button",{onClick:function(){U&&function(e,t){var c=document.createElement("a");c.download=t,c.href=e,document.body.appendChild(c),c.click(),document.body.removeChild(c)}(U.toDataURL({multiplier:3}),"startegy.png")},children:Object(i.jsx)("img",{className:"App-header-buttons-save",src:C,alt:"save"})})]})]}),Object(i.jsxs)("aside",{className:Z?"enter":"",children:[Object(i.jsx)("section",{onClick:function(){K(!1)},id:"closeArea"}),Object(i.jsxs)("section",{id:"sidebar",children:[Object(i.jsxs)(L,{title:"Markers",children:[Object(i.jsx)("button",{onClick:X,children:Object(i.jsx)("img",{src:k,alt:"thick PMC"})}),Object(i.jsx)("button",{onClick:X,children:Object(i.jsx)("img",{src:w,alt:"medium PMC"})}),Object(i.jsx)("button",{onClick:X,children:Object(i.jsx)("img",{src:y,alt:"light PMC"})}),Object(i.jsx)("button",{onClick:X,children:Object(i.jsx)("img",{src:D,alt:"light PMC"})})]}),Object(i.jsx)(L,{title:"",children:Object(i.jsx)(h.a,{color:E,triangle:"hide",onChangeComplete:function(e){R(e.hex),U&&(U.freeDrawingBrush.color=e.hex)}})})]})]}),Object(i.jsx)("div",{className:"Canvas",ref:e,children:Object(i.jsx)("canvas",{id:"canvas"})})]})},E=function(e){e&&e instanceof Function&&c.e(3).then(c.bind(null,208)).then((function(t){var c=t.getCLS,n=t.getFID,i=t.getFCP,r=t.getLCP,s=t.getTTFB;c(e),n(e),i(e),r(e),s(e)}))};o.a.render(Object(i.jsx)(s.a.StrictMode,{children:Object(i.jsx)(B,{})}),document.getElementById("root")),E()},86:function(e,t,c){},92:function(e,t){},93:function(e,t){},94:function(e,t){}},[[206,1,2]]]);
//# sourceMappingURL=main.00ec9e7d.chunk.js.map