"""Small reusable textured mesh primitives; all game geometry is generated here."""
from __future__ import annotations
import math
from panda3d.core import (
    Geom, GeomNode, GeomTriangles, GeomVertexData, GeomVertexFormat,
    GeomVertexWriter, NodePath, Texture, TextureStage, TransparencyAttrib,
)

_MESHES = {}


def _make_mesh(name, vertices, triangles):
    data = GeomVertexData(name, GeomVertexFormat.getV3n3t2(), Geom.UHStatic)
    pos = GeomVertexWriter(data, 'vertex')
    normal = GeomVertexWriter(data, 'normal')
    uv = GeomVertexWriter(data, 'texcoord')
    for p, n, t in vertices:
        pos.addData3(*p); normal.addData3(*n); uv.addData2(*t)
    indices = GeomTriangles(Geom.UHStatic)
    for a,b,c in triangles:
        indices.addVertices(a,b,c)
    indices.closePrimitive()
    geom = Geom(data); geom.addPrimitive(indices)
    node = GeomNode(name); node.addGeom(geom)
    return NodePath(node)


def _unit_box():
    if 'box' in _MESHES:
        return _MESHES['box']
    faces = [
        ((0,0,1), [(-.5,-.5,.5),(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5)]),
        ((0,0,-1), [(-.5,.5,-.5),(.5,.5,-.5),(.5,-.5,-.5),(-.5,-.5,-.5)]),
        ((0,-1,0), [(-.5,-.5,-.5),(.5,-.5,-.5),(.5,-.5,.5),(-.5,-.5,.5)]),
        ((0,1,0), [(.5,.5,-.5),(-.5,.5,-.5),(-.5,.5,.5),(.5,.5,.5)]),
        ((1,0,0), [(.5,-.5,-.5),(.5,.5,-.5),(.5,.5,.5),(.5,-.5,.5)]),
        ((-1,0,0), [(-.5,.5,-.5),(-.5,-.5,-.5),(-.5,-.5,.5),(-.5,.5,.5)]),
    ]
    vertices=[]; tris=[]; tex=[(0,0),(1,0),(1,1),(0,1)]
    for n,points in faces:
        base=len(vertices)
        vertices.extend((p,n,t) for p,t in zip(points,tex))
        tris.extend([(base,base+1,base+2),(base,base+2,base+3)])
    _MESHES['box']=_make_mesh('unit-box',vertices,tris)
    return _MESHES['box']


def _unit_cylinder(segments=24):
    key=('cylinder',segments)
    if key in _MESHES: return _MESHES[key]
    verts=[]; tris=[]
    for i in range(segments+1):
        a=2*math.pi*i/segments; x=math.cos(a); y=math.sin(a)
        verts.extend([((x*.5,y*.5,-.5),(x,y,0),(i/segments,0)),
                      ((x*.5,y*.5,.5),(x,y,0),(i/segments,1))])
    for i in range(segments):
        j=2*i; tris.extend([(j,j+2,j+3),(j,j+3,j+1)])
    for z,normal in ((.5,(0,0,1)),(-.5,(0,0,-1))):
        center=len(verts); verts.append(((0,0,z),normal,(.5,.5)))
        for i in range(segments+1):
            a=2*math.pi*i/segments; x=math.cos(a); y=math.sin(a)
            verts.append(((x*.5,y*.5,z),normal,(.5+x*.5,.5+y*.5)))
        for i in range(segments):
            if z>0: tris.append((center,center+i+1,center+i+2))
            else: tris.append((center,center+i+2,center+i+1))
    _MESHES[key]=_make_mesh('unit-cylinder',verts,tris)
    return _MESHES[key]


def _unit_sphere(segments=20, rings=12):
    key=('sphere',segments,rings)
    if key in _MESHES: return _MESHES[key]
    verts=[]; tris=[]
    for j in range(rings+1):
        v=j/rings; phi=-math.pi/2 + math.pi*v
        for i in range(segments+1):
            u=i/segments; theta=2*math.pi*u
            n=(math.cos(phi)*math.cos(theta),math.cos(phi)*math.sin(theta),math.sin(phi))
            verts.append(((n[0]*.5,n[1]*.5,n[2]*.5),n,(u,v)))
    for j in range(rings):
        for i in range(segments):
            a=j*(segments+1)+i; b=a+segments+1
            # Increasing u then v has outward winding on this parametrization.
            tris.extend([(a,a+1,b+1),(a,b+1,b)])
    _MESHES[key]=_make_mesh('unit-sphere',verts,tris)
    return _MESHES[key]


def _instance(mesh, parent, pos, scale, color, tex=None, uv=(1,1), name=''):
    obj=mesh.copyTo(parent)
    if name: obj.setName(name)
    obj.setPos(*pos); obj.setScale(*scale); obj.setColor(*color)
    if tex is not None:
        obj.setTexture(tex,1)
        if uv != (1,1): obj.setTexScale(TextureStage.getDefault(),uv[0],uv[1])
    if len(color)>3 and color[3] < 1:
        obj.setTransparency(TransparencyAttrib.MAlpha)
    return obj


def box(parent, pos, size, color=(1,1,1,1), tex=None, uv=(1,1), name=''):
    return _instance(_unit_box(),parent,pos,size,color,tex,uv,name)


def cylinder(parent, pos, size, color=(1,1,1,1), tex=None, uv=(1,1), name=''):
    """size is (diameter_x, diameter_y, height)."""
    return _instance(_unit_cylinder(),parent,pos,size,color,tex,uv,name)


def sphere(parent, pos, size, color=(1,1,1,1), tex=None, name=''):
    return _instance(_unit_sphere(),parent,pos,size,color,tex,(1,1),name)
