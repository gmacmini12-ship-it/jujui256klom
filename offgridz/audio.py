import numpy as np, wave
from scipy.signal import butter, sosfilt
SR=44100; N=SR*15
rng=np.random.RandomState(1)
L=np.zeros(N); R=np.zeros(N)
def add(sig,t0,g=1.0,pan=0.0):
    i=int(t0*SR); n=min(len(sig),N-i)
    if n<=0: return
    L[i:i+n]+=sig[:n]*g*(1-max(pan,0)); R[i:i+n]+=sig[:n]*g*(1+min(pan,0))
def filt(x,kind,f,order=2):
    return sosfilt(butter(order,f,btype=kind,fs=SR,output='sos'),x)
def impact(dur=1.2,f0=90,f1=38):
    t=np.arange(int(dur*SR))/SR
    ph=2*np.pi*(f1*t+(f0-f1)*0.06*(1-np.exp(-t/0.06)))
    s=np.sin(ph)*np.exp(-t/0.35)
    n=filt(rng.randn(len(t)),'low',900)*np.exp(-t/0.05)*0.6
    return s+n
def whoosh(dur=0.6,f0=300,f1=5000,peak=0.5):
    t=np.arange(int(dur*SR))/SR
    n=rng.randn(len(t)); out=np.zeros(len(t)); k=2048
    # swept bandpass via blocks
    for i in range(0,len(t),k):
        fc=f0*(f1/f0)**(i/len(t)); fc=min(fc,SR/2-500)
        seg=sosfilt(butter(2,[fc*0.7,fc*1.3],btype='band',fs=SR,output='sos'),n[i:i+k+512])[:k]
        out[i:i+len(seg)]=seg[:len(out[i:i+k])]
    env=np.sin(np.pi*np.clip(t/dur,0,1)**(1/peak*0.9+0.0))**2 if False else np.sin(np.pi*(t/dur)**0.7)**2
    return out*env*3
def tick(f=2200,dur=0.06):
    t=np.arange(int(dur*SR))/SR
    return np.sin(2*np.pi*f*t)*np.exp(-t/0.008)*0.5+filt(rng.randn(len(t)),'high',3000)*np.exp(-t/0.006)*0.3
def blip(f,dur=0.12):
    t=np.arange(int(dur*SR))/SR
    return np.sin(2*np.pi*f*t)*np.exp(-t/0.03)*0.4
def rip(dur=0.55):
    t=np.arange(int(dur*SR))/SR
    n=filt(rng.randn(len(t)),'high',1500)*(0.5+0.5*rng.rand(len(t)))
    return n*np.exp(-t/0.25)*np.clip(t/0.02,0,1)*1.2
def shimmer(dur=2.0):
    t=np.arange(int(dur*SR))/SR; s=0
    for f in [880,1320,1760,2640]:
        s=s+np.sin(2*np.pi*f*t+rng.rand()*6)*np.exp(-t/0.9)*0.08
    return s
# drone bed
t=np.arange(N)/SR
bed=(np.sin(2*np.pi*55*t)*0.10+np.sin(2*np.pi*82.5*t)*0.05+np.sin(2*np.pi*110.3*t)*0.03)
bed*=np.clip(t/1.5,0,1)*np.clip((15-t)/1.0,0,1)*(0.7+0.3*np.sin(2*np.pi*t/7.5))
tex=filt(rng.randn(N),'band',[2000,7000])*0.012
L+=bed+tex; R+=bed+tex
# scene A
add(whoosh(0.7,200,3500),0.0,0.35,-0.2); add(impact(1.4),0.42,0.8)
add(whoosh(0.5,400,4000),1.2,0.2,0.2); add(tick(1800),1.3,0.35); add(tick(2400),1.6,0.3)
# A->B red wipe
add(whoosh(0.35,500,6000),2.8,0.55); add(impact(0.9,110,45),3.0,0.9)
# B
add(impact(0.7,70,40),3.4,0.55)
for tt,f in [(4.05,1320),(4.15,1760),(4.7,990),(4.82,1480),(5.45,1180)]: add(blip(f),tt,0.35,0.3)
add(tick(2600),5.1,0.35)
# B->C tear
add(rip(0.6),5.9,0.6); add(whoosh(0.5,300,2500),5.82,0.3); add(impact(1.3,85,36),6.08,0.95)
add(whoosh(1.2,150,2200),6.2,0.28,-0.3); add(shimmer(1.5),6.9,0.4)
# C->D paper
add(whoosh(0.7,150,1600),8.78,0.5); add(impact(0.8,75,40),9.35,0.7)
add(rip(0.35)*0.5,9.0,0.4)
for k in range(10): add(tick(1500+ (k%2)*300),9.9+0.5*k,0.45,0.2)
for tt in [10.55,10.97,11.39]: add(whoosh(0.3,600,3500),tt-0.05,0.25); add(impact(0.5,160,70),tt+0.18,0.3)
add(whoosh(0.6,300,6000),11.5,0.4)
# mosaic
for i,tt in enumerate([12.0,12.16,12.32,12.48]):
    add(impact(0.7,130,50),tt,0.65,[0.5,-0.2,0.2,-0.5][i]); add(whoosh(0.35,800,5000),tt-0.05,0.25)
# logo
add(impact(2.0,70,32),13.05,1.0); add(shimmer(2.2),13.1,0.7)
for i in range(8): add(tick(3000+i*200),13.08+0.07*i,0.25,-0.4+0.11*i)
add(whoosh(0.5,500,4500),13.9,0.3); add(impact(1.5,60,30),13.98,0.6)
add(whoosh(0.4,500,4500),14.15,0.2)
st=np.stack([L,R],1)
st=filt(st.T,'high',25).T
st=np.tanh(st*1.3)
st*= 0.89/np.abs(st).max()
# fade tail very slightly
st[-int(0.15*SR):]*=np.linspace(1,0.0,int(0.15*SR))[:,None]**0.5
with wave.open('/tmp/w/audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st*32767).astype(np.int16).tobytes())
print('ok')
