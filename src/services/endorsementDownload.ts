export async function downloadEndorsement(id:number) {
  const token=localStorage.getItem("token")||sessionStorage.getItem("token")||localStorage.getItem("authToken")||sessionStorage.getItem("authToken")||"";
  const response=await fetch(`/api/sgms/endorsements/${id}/pdf`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||"Unable to download the approved PDF.");}
  const url=URL.createObjectURL(await response.blob());
  const anchor=document.createElement("a");anchor.href=url;anchor.download=`endorsement-${id}.pdf`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
