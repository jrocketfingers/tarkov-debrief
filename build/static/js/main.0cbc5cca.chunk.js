(this.webpackJsonpdebrief=this.webpackJsonpdebrief||[]).push([[0],{14:function(e,t,n){},21:function(e,t){},22:function(e,t){},23:function(e,t){},25:function(e,t,n){},26:function(e,t,n){"use strict";n.r(t);var c,r=n(0),i=n(1),a=n.n(i),s=n(7),o=n.n(s),u=(n(14),n(6)),l=n.n(u),d=n(8),b=n(2),j=n(4),f=n(3),m=(n(24),n.p+"static/media/interchange.d1c1fd49.png"),h=(n(25),n.p+"static/media/select.87afa2df.svg"),p=n.p+"static/media/pencil.e46769b8.svg",g=n.p+"static/media/eraser.fa7a8623.svg",v=n.p+"static/media/undo.d1789e03.svg",O=n.p+"static/media/marker.bde95ba7.svg",x=n.p+"static/media/save.701089e7.svg",C=n.p+"static/media/pmc-thick.9fc764b6.svg",k=n.p+"static/media/pmc-med.e46af3bd.svg",w=n.p+"static/media/pmc-light.f8f79686.svg",y=n.p+"static/media/scav.231f3e54.svg",D={width:300,height:300},P=new Set;var M={};var S=function(){var e=Object(i.useRef)(null),t=Object(i.useState)({type:"pencil",active:!0,onClick:null,cursor:null}),n=Object(j.a)(t,2),a=n[0],s=n[1],o=Object(i.useRef)({type:"pencil",active:!0,onClick:null,cursor:null}),u=Object(i.useState)(null),S=Object(j.a)(u,2)[1],L=Object(i.useRef)(null),N=Object(i.useState)(null),E=Object(j.a)(N,2),R=E[0],A=E[1],B=Object(i.useState)(!1),F=Object(j.a)(B,2),I=F[0],T=F[1],z=function(e){R&&(a.onClick&&R.off("mouse:up",a.onClick),e.onClick&&R.on("mouse:up",e.onClick),null===e.cursor?(R.defaultCursor="auto",R.hoverCursor="auto"):(R.defaultCursor=e.cursor,R.hoverCursor=R.defaultCursor),"pencil"===e.type?R.isDrawingMode=!0:R.isDrawingMode=!1),T(!1),s(e),o.current=e},U=function(e){var t,n=e.target;t=n.src,S(t),L.current=t;var c="url(".concat(n.src,"), auto");z(Object(b.a)(Object(b.a)({},a),{},{type:"marker",onClick:H,cursor:c}))},H=function(){var e=Object(d.a)(l.a.mark((function e(t){var n,c,r,i,a;return l.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:if(!L||!L.current){e.next=17;break}if(n=M[L.current]){e.next=8;break}return e.next=5,new Promise((function(e){return f.fabric.Image.fromURL(L.current,e)}));case 5:c=e.sent,M[L.current]=c,n=c;case 8:return e.next=10,new Promise((function(e){return n.clone(e)}));case 10:r=e.sent,i=R.getPointer(t.e),r.left=i.x,r.top=i.y,a=R.getZoom(),r.scale(1/a),R.add(r);case 17:case"end":return e.stop()}}),e)})));return function(t){return e.apply(this,arguments)}}();return Object(i.useEffect)((function(){if(!R){var t=function(){var e=new f.fabric.Canvas("canvas",{height:D.height,width:D.width,perPixelTargetFind:!0,selection:!1});return e.freeDrawingBrush.color="red",e.freeDrawingBrush.width=5,e.setCursor("url(".concat(p,")")),e}();A(t),f.fabric.Image.fromURL(m,(function(e){e.canvas=t,e.selectable=!1,c=e,P.add(c.getSrc()),t.add(e),t.clearHistory()})),t.on("mouse:down",(function(e){z(Object(b.a)(Object(b.a)({},o.current),{},{active:!0}))})),t.on("mouse:up",(function(e){z(Object(b.a)(Object(b.a)({},o.current),{},{active:!1}))})),t.on("mouse:move",(function(e){null!==e.target&&(e.target instanceof f.fabric.Image&&P.has(e.target.getSrc())||"eraser"===o.current.type&&o.current.active&&t.remove(e.target))})),t.on("mouse:wheel",(function(e){var n=e.e,c=n.deltaY,r=t.getZoom();(r*=Math.pow(.999,c))>20&&(r=20),r<.01&&(r=.01),t.zoomToPoint({x:n.offsetX,y:n.offsetY},r),t.freeDrawingBrush.width=5/r,e.e.preventDefault(),e.e.stopPropagation()}))}function n(){if(e.current){var t=e.current.offsetWidth,n=e.current.offsetHeight;null===R||void 0===R||R.setDimensions({width:t,height:n})}else null===R||void 0===R||R.setDimensions(D)}return n(),window.addEventListener("resize",n),document.addEventListener("keyup",(function(e){var t=e.key;e.ctrlKey&&"z"===t&&R&&R.undo()})),function(){window.removeEventListener("resize",n)}}),[e,R]),Object(r.jsxs)("div",{className:"App",children:[Object(r.jsxs)("header",{className:"App-header",children:[Object(r.jsx)("p",{className:"title",children:"Tarkov Debrief"}),Object(r.jsxs)("section",{className:"App-header-buttons",children:[Object(r.jsx)("button",{onClick:function(){z(Object(b.a)(Object(b.a)({},a),{},{type:"select",cursor:null,onClick:null})),R&&(R.isDrawingMode=!1,R.selection=!0)},children:Object(r.jsx)("img",{src:h,alt:"select"})}),Object(r.jsx)("button",{onClick:function(){z(Object(b.a)(Object(b.a)({},a),{},{type:"pencil",cursor:null,onClick:null})),R&&(R.isDrawingMode=!0)},children:Object(r.jsx)("img",{src:p,alt:"pencil"})}),Object(r.jsx)("button",{onClick:function(){z(Object(b.a)(Object(b.a)({},a),{},{type:"eraser",cursor:null,onClick:null})),R&&(R.isDrawingMode=!1,R.selection=!1)},children:Object(r.jsx)("img",{src:g,alt:"eraser"})}),Object(r.jsx)("button",{onClick:function(){R&&R.undo()},children:Object(r.jsx)("img",{src:v,alt:"undo"})}),Object(r.jsx)("button",{onClick:function(){T(!0)},children:Object(r.jsx)("img",{src:O,alt:"undo"})}),Object(r.jsx)("button",{onClick:function(){R&&function(e,t){var n=document.createElement("a");n.download=t,n.href=e,document.body.appendChild(n),n.click(),document.body.removeChild(n)}(R.toDataURL({multiplier:3}),"startegy.png")},children:Object(r.jsx)("img",{className:"App-header-buttons-save",src:x,alt:"save"})})]})]}),Object(r.jsxs)("aside",{className:I?"enter":"",children:[Object(r.jsx)("section",{onClick:function(){T(!1)},id:"closeArea"}),Object(r.jsxs)("section",{id:"sidebar",children:[Object(r.jsx)("button",{onClick:U,children:Object(r.jsx)("img",{src:C,alt:"thick PMC"})}),Object(r.jsx)("button",{onClick:U,children:Object(r.jsx)("img",{src:k,alt:"medium PMC"})}),Object(r.jsx)("button",{onClick:U,children:Object(r.jsx)("img",{src:w,alt:"light PMC"})}),Object(r.jsx)("button",{onClick:U,children:Object(r.jsx)("img",{src:y,alt:"light PMC"})})]})]}),Object(r.jsx)("div",{className:"Canvas",ref:e,children:Object(r.jsx)("canvas",{id:"canvas"})})]})},L=function(e){e&&e instanceof Function&&n.e(3).then(n.bind(null,27)).then((function(t){var n=t.getCLS,c=t.getFID,r=t.getFCP,i=t.getLCP,a=t.getTTFB;n(e),c(e),r(e),i(e),a(e)}))};o.a.render(Object(r.jsx)(a.a.StrictMode,{children:Object(r.jsx)(S,{})}),document.getElementById("root")),L()}},[[26,1,2]]]);
//# sourceMappingURL=main.0cbc5cca.chunk.js.map