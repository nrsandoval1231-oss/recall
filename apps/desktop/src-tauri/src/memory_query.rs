//! Bounded local retrieval with explicit source quotes; no generated factual claims.
use crate::local_vault::Vault;
use serde::Serialize;
use std::collections::BTreeSet;
#[derive(Debug,Serialize)]
pub struct Hit {
    pub memory_id:String,pub revision:u64,pub note_basename:String,
    pub current_excerpt:String,pub original_excerpt:String,pub source_sha256:String,
    pub mime_type:String,
}
#[derive(Debug,Serialize)]
pub struct Answer {pub question:String,pub message:String,pub hits:Vec<Hit>,pub knowledge_status:Option<crate::knowledge::ServiceStatus>,pub graph_relationships:Vec<crate::knowledge::Relationship>}
fn terms(question:&str)->BTreeSet<String> {
    let ignored=["what","that","with","about","going","there","this","were","when","have","does","which","would","could","please","recall","tell","from","happened"];
    let mut words:BTreeSet<_>=question.split(|c:char|!c.is_alphanumeric()).filter(|w|w.len()>=3)
        .map(str::to_lowercase).filter(|w|!ignored.contains(&w.as_str())).collect();
    if words.iter().any(|w|["delay","delayed","late"].contains(&w.as_str())){words.extend(["delay","delayed","late"].into_iter().map(str::to_owned));}
    words
}
fn score(text:&str,terms:&BTreeSet<String>)->usize {
    let words:BTreeSet<_>=text.split(|c:char|!c.is_alphanumeric()).map(str::to_lowercase).collect();
    terms.intersection(&words).count()
}
pub fn ask(vault:&Vault,question:&str)->Result<Answer,String> {
    if question.trim().is_empty() || question.len()>4096 {return Err("Ask a bounded memory question".into());}
    let terms=terms(question);let mut ranked:Vec<_>=vault.list_with_deleted("",false)?.into_iter()
        .filter(|m|m.state=="active" && m.conflict.is_none())
        .map(|m|(score(&m.note,&terms),m)).filter(|(score,_)|*score>0).collect();
    ranked.sort_by(|a,b|b.0.cmp(&a.0).then(a.1.id.cmp(&b.1.id)));
    let mut hits=Vec::new();
    for (_,memory) in ranked.into_iter().take(3) {
        let snapshot=vault.processing_snapshot(&memory.id,memory.revision)?;
        let original=if snapshot.source.mime_type=="text/plain" {
            std::str::from_utf8(&snapshot.source.bytes).map_err(|_|"Original text is not UTF-8")?.chars().take(1200).collect()
        }else {"Original photo available for inspection; no unverified transcription is presented as source text.".into()};
        hits.push(Hit{memory_id:memory.id,revision:memory.revision,note_basename:memory.note_path.ok_or("Missing note destination")?,
            current_excerpt:memory.note.chars().take(1200).collect(),original_excerpt:original,source_sha256:snapshot.source.sha256,mime_type:snapshot.source.mime_type});
    }
    Ok(Answer{question:question.into(),message:if hits.is_empty(){"No verified local memory matched this wording."}else{"Source-backed matches. Review current notes and original evidence; these are retrieved quotes, not a generated answer."}.into(),hits,knowledge_status:None,graph_relationships:Vec::new()})
}
pub fn ask_with_knowledge(vault:&Vault,question:&str)->Result<Answer,String> {
    let mut answer=ask(vault,question)?;
    match crate::knowledge::search(vault,question,false) {
        Ok(reply) => {
            answer.knowledge_status=Some(reply.status);
            answer.graph_relationships=reply.relationships;
            if !answer.graph_relationships.is_empty() {
                answer.message=if answer.hits.is_empty() {
                    "Related graph knowledge was found. These are inferred, unverified relationships; inspect the cited current notes. This is not a generated answer.".into()
                } else {
                    "Source-backed matches and related graph knowledge were found. Graph relationships are inferred and unverified; inspect the cited current notes. This is not a generated answer.".into()
                };
            }
        }
        Err(_) => {
            answer.knowledge_status=Some(crate::knowledge::ServiceStatus {
                state:"unavailable".into(),pending:0,indexed:0,failed:0,
                message:"Related knowledge is temporarily unavailable; local source search remains available.".into(),providers:None,
            });
        }
    }
    Ok(answer)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn vague_delay_question_retrieves_persisted_meeting_and_original(){
        use crate::librarian::organization_tests as fixture;
        let (t,v,parser,memory)=fixture::setup();let organization=uuid::Uuid::new_v4().to_string();
        crate::librarian::organize_selected(&v,&fixture::config(),&parser,&organization,true,&fixture::claude()).unwrap();
        v.publish_meeting(&parser,&organization,&uuid::Uuid::new_v4().to_string()).unwrap();
        let answer=ask(&Vault::open(&t.0).unwrap(),"What was going on with that utility delay?").unwrap();
        assert_eq!(answer.hits.len(),1);assert_eq!(answer.hits[0].memory_id,memory);assert_eq!(answer.hits[0].revision,2);
        assert!(answer.hits[0].original_excerpt.contains("Utility late."));assert!(answer.hits[0].original_excerpt.contains("Crossed out: 8 MW confirmed."));
        assert_eq!(answer.hits[0].source_sha256,v.source(&memory).unwrap().sha256);
    }
    #[test] fn empty_unrelated_questions_do_not_invent_answers(){
        use crate::librarian::organization_tests as fixture;
        let (_t,v,_,_)=fixture::setup();assert!(ask(&v," ").is_err());assert!(ask(&v,"unrelated zebras").unwrap().hits.is_empty());
    }
}
